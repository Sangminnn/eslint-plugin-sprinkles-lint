const path = require('path');
const {
  isEmpty,
  isObject,
  isArray,
  isStyleArray,
  isVariable,
  hasSelectors,
  checkDefinedValueInSprinkles,
  separateProps,
  createTransformTemplate,
  isSprinklesCall,
  findSprinklesCallInArray,
  checkSeparatedCorrectly,
  hasNestedSelectors,
} = require('./utils');
const { getSprinklesConfig } = require('./sprinkles-discovery');

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Use Sprinkles for predefined style properties',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          sprinklesConfig: {
            type: 'object',
            properties: {
              properties: {
                type: 'object',
                additionalProperties: {
                  oneOf: [
                    {
                      type: 'array',
                      items: {
                        oneOf: [{ type: 'string' }, { type: 'number' }],
                      },
                    },
                    {
                      type: 'object',
                      additionalProperties: {
                        type: 'string',
                      },
                    },
                  ],
                },
              },
              shorthands: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          configPath: {
            type: 'string',
          },
          sprinklesImportSource: {
            type: 'string',
          },
          hoistableOverrideProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useSprinkles: "🚨 '{{ property }}' is defined in Sprinkles. Use sprinkles property instead.",
      manualSeparationRequired:
        "'{{ property }}' can move to Sprinkles, but it sits in an override object composed with other classes. Moving it changes cascade order — move manually and verify the rendered result.",
      hoistToSprinkles: "Move '{{ property }}' into sprinkles() (verify this class is not overriding a composed class first)",
      removeStyle: 'Style wrapper should be removed',
    },
    fixable: 'code',
    hasSuggestions: true,
  },

  create(context) {
    const options = context.options[0] || {};
    const config = getSprinklesConfig(options);

    if (!config) {
      // If no config found, skip processing
      return {};
    }

    const { sprinklesConfig, shorthands } = config;

    const sourceCode = context.getSourceCode();
    const separateWithConfig = (properties) =>
      separateProps({
        sprinklesConfig,
        shorthands: shorthands ? [...shorthands] : undefined,
        properties,
        sourceCode,
      });

    // When props already inside sprinkles() are merged with the style object for re-separation,
    // the message should only name the props that are about to move into sprinkles().
    const listPropsMovingIntoSprinkles = (sprinklesProps, sprinklesCall) => {
      const existingNames = (sprinklesCall?.arguments?.[0]?.properties || []).map((prop) => prop.key.name || prop.key.value);
      const movingNames = Object.keys(sprinklesProps).filter((name) => !existingNames.includes(name));
      const names = movingNames.length > 0 ? movingNames : Object.keys(sprinklesProps);

      return names.join(', ');
    };

    const programBody = sourceCode.ast.body;
    const importsSprinkles = (statement) =>
      statement.type === 'ImportDeclaration' && statement.specifiers.some((specifier) => specifier.local?.name === 'sprinkles');
    // Imports hoist, so the whole program body is checked instead of relying on traversal order.
    const hasSprinklesImport = programBody.some(importsSprinkles);

    const isDirective = (statement) => statement.type === 'ExpressionStatement' && typeof statement.directive === 'string';
    const firstNonDirectiveStatement = programBody.find((statement) => !isDirective(statement));

    // Inserting `sprinkles(...)` into a file that never imports it produces code that does not compile.
    // Fixes that emit a sprinkles call are offered as-is when the import is present, extended with an
    // import insertion when `sprinklesImportSource` is configured, and withheld otherwise.
    const withSprinklesImport = (buildFix) => {
      if (hasSprinklesImport) {
        return buildFix;
      }

      if (!options.sprinklesImportSource || !firstNonDirectiveStatement) {
        return undefined;
      }

      return (fixer) => {
        const importStatement = `import { sprinkles } from '${options.sprinklesImportSource}';\n`;
        const insertImport = fixer.insertTextBefore(firstNonDirectiveStatement, importStatement);

        return [].concat(buildFix(fixer), insertImport);
      };
    };

    return {
      CallExpression(node) {
        // using style
        if (node.callee.name === 'style') {
          // if style({}), {} is node.arguments[0]
          const styleArgument = node.arguments[0];

          // Case. style({})
          if (isObject(styleArgument)) {
            try {
              const { sprinklesProps, remainingProps} = separateWithConfig(styleArgument.properties);

              if (isEmpty(sprinklesProps)) {
                return;
              }

              const targetProperties = Object.keys(sprinklesProps).join(', ');

              context.report({
                node: styleArgument,
                messageId: 'useSprinkles',
                data: {
                  property: targetProperties,
                },
                fix: withSprinklesImport((fixer) => {
                  return fixer.replaceText(
                    node,
                    createTransformTemplate({
                      sourceCode,
                      sprinklesProps,
                      remainingProps,
                    }),
                  );
                }),
              });
            } catch (error) {
              // if error, continue
            }
          }

          // Case. style([])
          if (isArray(styleArgument)) {
            const sprinklesCall = findSprinklesCallInArray(styleArgument);
            const variables = styleArgument?.elements?.filter((el) => el !== sprinklesCall && isVariable(el));
            const isEmptySprinkles = !sprinklesCall || !sprinklesCall.arguments?.[0];

            // already use sprinkles but some properties are in style object not in sprinkles
            if (sprinklesCall) {
              if (isEmptySprinkles) return;
              const nonSprinklesObject = styleArgument.elements.find((element) => isObject(element));

              const sprinklesProperties = sprinklesCall?.arguments?.[0]?.properties || [];
              const nonSprinklesProperties = nonSprinklesObject?.properties || [];

              try {
                const isSeparatedCorrectly = checkSeparatedCorrectly({
                  sprinklesConfig,
                  shorthands: shorthands ? [...shorthands] : undefined,
                  sourceCode,
                  sprinklesProps: sprinklesProperties,
                  remainingProps: nonSprinklesProperties,
                });

                // if sprinkles and nonSprinkles are separated correctly, return instantly
                if (isSeparatedCorrectly) {
                  const hasSprinklesOnly = styleArgument.elements.length === 1 && styleArgument.elements[0] === sprinklesCall;
                  if (hasSprinklesOnly) {
                    context.report({
                      node,
                      messageId: 'removeStyle',
                      fix(fixer) {
                        return sprinklesCall ? fixer.replaceText(node, sourceCode.getText(sprinklesCall)) : fixer.replaceText(node, `[]`);
                      },
                    });
                  }

                  return;
                }
              } catch (error) {
                // if error, continue
              }

              // A sprinkles atom and a local style() rule share the same specificity, so the winner is
              // decided by sheet order. Properties left in the override object are there to beat the
              // composed classes; hoisting them into sprinkles() would reorder the cascade.
              if (nonSprinklesObject) {
                const { sprinklesProps: movableProps } = separateWithConfig(nonSprinklesProperties);

                if (isEmpty(movableProps)) {
                  return;
                }

                const movableNames = Object.keys(movableProps).join(', ');
                const reportManualSeparation = (suggestionFix) =>
                  context.report({
                    node,
                    messageId: 'manualSeparationRequired',
                    data: {
                      property: movableNames,
                    },
                    ...(suggestionFix ? { suggest: [{ messageId: 'hoistToSprinkles', data: { property: movableNames }, fix: suggestionFix }] } : {}),
                  });

                // The merged template is only trustworthy for the one shape the merge path handles: a single
                // override object, no property declared on both sides (the merge is first-wins, so the override
                // value would be dropped), and a sprinkles() call the separator can read (a spread makes it
                // return nothing and the template collapses to `{}`).
                const propertyName = (prop) => (prop.key ? prop.key.name || prop.key.value : null);
                const sprinklesNames = new Set(sprinklesProperties.map(propertyName).filter(Boolean));
                const hasSingleOverrideObject = styleArgument.elements.filter(isObject).length === 1;
                const hasOverlappingProperty = nonSprinklesProperties.some((prop) => sprinklesNames.has(propertyName(prop)));
                const merged = separateWithConfig([...sprinklesProperties, ...nonSprinklesProperties]);
                const canHoist = hasSingleOverrideObject && !hasOverlappingProperty && !isEmpty(merged.sprinklesProps);

                if (!canHoist) {
                  reportManualSeparation(undefined);
                  return;
                }

                // The plugin cannot see component bases, but the project can: properties it declares as never
                // set by a composed base are safe to hoist, so they take the regular autofix path below.
                const hoistableProperties = new Set(options.hoistableOverrideProperties || []);
                const allMovableAreHoistable = Object.keys(movableProps).every((name) => hoistableProperties.has(name));

                if (!allMovableAreHoistable) {
                  // The transformation is mechanical; only the decision to apply it needs the call sites, so it is
                  // offered as an IDE suggestion that never runs under --fix. (ESLint builds suggestion fixes eagerly.)
                  const hoisted = createTransformTemplate({ sourceCode, variables, sprinklesProps: merged.sprinklesProps, remainingProps: merged.remainingProps });
                  reportManualSeparation(withSprinklesImport((fixer) => fixer.replaceText(node, hoisted)));
                  return;
                }
              }

              const allProperties = [...sprinklesProperties, ...nonSprinklesProperties];

              try {
                const { sprinklesProps, remainingProps } = separateWithConfig(allProperties);

                if (isEmpty(sprinklesProps)) {
                  const formattedRemainingProps = Object.entries(remainingProps)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(',\n  ');

                  context.report({
                    node,
                    messageId: 'useSprinkles',
                    data: {
                      property: 'all',
                    },
                    fix(fixer) {
                      const remainingObject = `{\n  ${formattedRemainingProps}\n}`;

                      if (variables.length === 0) {
                        return fixer.replaceText(node, `style(${remainingObject})`);
                      }

                      const variableTexts = variables.map((el) => sourceCode.getText(el)).join(', ');
                      return fixer.replaceText(node, `style([${variableTexts}, ${remainingObject}])`);
                    },
                  });
                  return;
                }

                const targetProperties = listPropsMovingIntoSprinkles(sprinklesProps, sprinklesCall);

                context.report({
                  node,
                  messageId: 'useSprinkles',
                  data: {
                    property: targetProperties,
                  },
                  fix: withSprinklesImport((fixer) => {
                    return fixer.replaceText(
                      node,
                      createTransformTemplate({
                        sourceCode,
                        variables,
                        sprinklesProps,
                        remainingProps,
                      }),
                    );
                  }),
                });
              } catch (error) {
                // if error, continue
              }
              return;
            }

            // not use sprinkles and use only style object, but some properties have to place in sprinkles
            if (!sprinklesCall) {
              styleArgument.elements?.forEach((element) => {
                if (!isObject(element) || hasSelectors(element.properties)) {
                  return;
                }

                try {
                  const { sprinklesProps, remainingProps } = separateWithConfig(element.properties);

                  if (isEmpty(sprinklesProps)) {
                    return;
                  }

                  const targetProperties = Object.keys(sprinklesProps).join(', ');

                  context.report({
                    node,
                    messageId: 'useSprinkles',
                    data: {
                      property: targetProperties,
                    },
                    fix: withSprinklesImport((fixer) => {
                      return fixer.replaceText(
                        node,
                        createTransformTemplate({
                          sourceCode,
                          variables,
                          sprinklesProps,
                          remainingProps,
                        }),
                      );
                    }),
                  });
                } catch (error) {
                  // if error, continue
                }
              });
            }
          }
        }

        // using recipe
        if (node.callee.name === 'recipe') {
          const recipeArgument = node.arguments[0];
          const baseProperty = recipeArgument.properties.find((prop) => prop.key.name === 'base');

          /** base in recipe */
          if (baseProperty) {
            const baseValue = baseProperty.value;
            let targetArray;

            // Case. style([...])
            if (isStyleArray(baseValue)) {
              targetArray = baseValue.arguments[0];
            }
            // Case. [...]
            else if (isArray(baseValue)) {
              targetArray = baseValue;
            } else if (isObject(baseValue)) {
              targetArray = {
                elements: [baseValue],
              };
            }

            if (targetArray) {
              const sprinklesCall = findSprinklesCallInArray(targetArray);

              if (sprinklesCall && targetArray.elements.length === 1) {
                context.report({
                  node: baseProperty.value,
                  messageId: 'removeStyle',
                  fix(fixer) {
                    return fixer.replaceText(baseProperty.value, sourceCode.getText(sprinklesCall));
                  },
                });
                return;
              }

              const variables = targetArray?.elements?.filter((el) => el !== sprinklesCall && isVariable(el)) || [];
              const styleObjects = targetArray?.elements?.filter((el) => el !== sprinklesCall && isObject(el)) || [];

              if (!targetArray.elements || targetArray.elements.length === 0) {
                return;
              }

              const isOnlyVariables = variables.length > 0 && styleObjects.length === 0;
              /** case. style([variable, sprinklesCall]) */
              const isOnlySprinklesAndVariables = sprinklesCall && variables.length + 1 === targetArray.elements.length;

              if (isOnlyVariables || isOnlySprinklesAndVariables) {
                return;
              }

              const allProperties = [];

              const hasSprinkles = sprinklesCall && sprinklesCall.arguments && sprinklesCall.arguments[0];
              if (hasSprinkles) {
                const sprinklesProperties = sprinklesCall?.arguments?.[0]?.properties || [];
                allProperties.push(...sprinklesProperties);
              }

              for (const styleObject of styleObjects) {
                if (styleObject.properties) {
                  allProperties.push(...styleObject.properties);
                }
              }

              if (allProperties.length === 0) {
                return;
              }

              try {
                if (sprinklesCall && styleObjects.length > 0) {
                  const sprinklesProperties = sprinklesCall?.arguments?.[0]?.properties || [];
                  const allStyleProps = [];

                  for (const styleObject of styleObjects) {
                    if (styleObject.properties) {
                      allStyleProps.push(...styleObject.properties);
                    }
                  }

                  const isSeparatedCorrectly = checkSeparatedCorrectly({
                    sprinklesConfig,
                    shorthands: shorthands ? [...shorthands] : undefined,
                    sourceCode,
                    sprinklesProps: sprinklesProperties,
                    remainingProps: allStyleProps,
                  });

                  if (isSeparatedCorrectly) {
                    return;
                  }
                }

                const { sprinklesProps, remainingProps } = separateWithConfig(allProperties);

                if (!isEmpty(sprinklesProps)) {
                  const targetProperties = listPropsMovingIntoSprinkles(sprinklesProps, sprinklesCall);

                  context.report({
                    node: baseProperty.value,
                    messageId: 'useSprinkles',
                    data: {
                      property: targetProperties,
                    },
                    fix: withSprinklesImport((fixer) => {
                      return fixer.replaceText(
                        baseProperty.value,
                        createTransformTemplate({
                          sourceCode,
                          variables,
                          sprinklesProps,
                          remainingProps,
                          isArrayContext: variables.length > 0 || !isEmpty(remainingProps),
                        }),
                      );
                    }),
                  });
                }
              } catch (error) {}
            }
          }

          const variantsProperty = recipeArgument.properties.find((prop) => prop.key.name === 'variants');

          /** variants check */
          if (variantsProperty && isObject(variantsProperty.value)) {
            const directCheckVariantValue = (valueNode) => {
              if (!isObject(valueNode) || !valueNode.properties) return;
              if (isSprinklesCall(valueNode)) return;
              if (hasSelectors(valueNode.properties) || hasNestedSelectors(valueNode.properties)) return;

              try {
                let hasDefinedSprinklesProps = false;

                for (const prop of valueNode.properties) {
                  const propName = prop.key.name || prop.key.value;
                  const propValue = sourceCode.getText(prop.value);

                  const isDefinedInSprinkles = checkDefinedValueInSprinkles({
                    sprinklesConfig,
                    shorthands: shorthands ? [...shorthands] : undefined,
                    propName,
                    value: propValue,
                  });

                  if (isDefinedInSprinkles) {
                    hasDefinedSprinklesProps = true;
                    break;
                  }
                }

                if (!hasDefinedSprinklesProps) return;

                const { sprinklesProps, remainingProps } = separateWithConfig(valueNode.properties);

                if (isEmpty(sprinklesProps)) return;

                context.report({
                  node: valueNode,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(sprinklesProps).join(', '),
                  },
                  fix: withSprinklesImport((fixer) => {
                    const transformResult = createTransformTemplate({
                      sourceCode,
                      sprinklesProps,
                      remainingProps,
                      isArrayContext: !isEmpty(remainingProps),
                    });

                    // null이 반환되면 빈 배열 또는 빈 객체로 대체
                    if (transformResult === null) {
                      return fixer.replaceText(valueNode, !isEmpty(remainingProps) ? '[]' : '{}');
                    }

                    return fixer.replaceText(valueNode, transformResult);
                  }),
                });
              } catch (error) {}
            };

            const checkArrayStylesInVariant = (node) => {
              if (!isArray(node) || !node.elements) return;

              const sprinklesCall = findSprinklesCallInArray(node);
              const styleObjects = node.elements.filter((element) => isObject(element) && element !== sprinklesCall);
              const variables = node.elements.filter((el) => el !== sprinklesCall && isVariable(el));

              const hasSprinklesOnly = node.elements.length === 1 && sprinklesCall;
              if (hasSprinklesOnly) {
                context.report({
                  node,
                  messageId: 'removeStyle',
                  fix(fixer) {
                    return fixer.replaceText(node, sourceCode.getText(sprinklesCall));
                  },
                });
                return;
              }

              if (sprinklesCall && styleObjects.length > 0) {
                try {
                  const sprinklesProperties = sprinklesCall?.arguments?.[0]?.properties || [];
                  const allStyleProps = [];

                  for (const styleObject of styleObjects) {
                    if (styleObject.properties) {
                      allStyleProps.push(...styleObject.properties);
                    }
                  }

                  const isSeparatedCorrectly = checkSeparatedCorrectly({
                    sprinklesConfig,
                    shorthands: shorthands ? [...shorthands] : undefined,
                    sourceCode,
                    sprinklesProps: sprinklesProperties,
                    remainingProps: allStyleProps,
                  });

                  if (isSeparatedCorrectly) return;
                } catch (error) {}
              }

              const allProperties = [];

              const hasSprinkles = sprinklesCall && sprinklesCall.arguments && sprinklesCall.arguments[0];
              if (hasSprinkles) {
                const sprinklesProperties = sprinklesCall.arguments[0].properties || [];
                allProperties.push(...sprinklesProperties);
              }

              for (const styleObject of styleObjects) {
                if (styleObject.properties) {
                  allProperties.push(...styleObject.properties);
                }
              }

              if (allProperties.length === 0) return;

              try {
                const { sprinklesProps, remainingProps } = separateWithConfig(allProperties);

                if (isEmpty(sprinklesProps)) return;

                context.report({
                  node,
                  messageId: 'useSprinkles',
                  data: {
                    property: listPropsMovingIntoSprinkles(sprinklesProps, sprinklesCall),
                  },
                  fix: withSprinklesImport((fixer) => {
                    const transformResult = createTransformTemplate({
                      sourceCode,
                      variables,
                      sprinklesProps,
                      remainingProps,
                      isArrayContext: !(isEmpty(remainingProps) && variables.length === 0),
                    });

                    // null이 반환되면 빈 배열 또는 빈 객체로 대체
                    if (transformResult === null) {
                      return fixer.replaceText(node, !(isEmpty(remainingProps) && variables.length === 0) ? '[]' : '{}');
                    }

                    return fixer.replaceText(node, transformResult);
                  }),
                });
              } catch (error) {}
            };

            const findAndCheckStylesInVariant = (node) => {
              if (!node || !node.properties) return;

              checkStylesInVariant(node);

              node.properties.forEach((prop) => {
                if (!prop || !prop.value) return;

                if (isArray(prop.value)) {
                  checkArrayStylesInVariant(prop.value);
                  return;
                }

                if (isObject(prop.value)) {
                  if (prop.value.properties) {
                    prop.value.properties.forEach((nestedProp) => {
                      const isArrayValue = nestedProp && nestedProp.value && isArray(nestedProp.value);
                      if (isArrayValue) {
                        checkArrayStylesInVariant(nestedProp.value);
                      }
                    });
                  }

                  findAndCheckStylesInVariant(prop.value);
                }
              });
            };

            const checkStylesInVariant = (node) => {
              if (!isObject(node) || !node.properties) return;

              try {
                const { sprinklesProps, remainingProps } = separateWithConfig(node.properties);

                if (isEmpty(sprinklesProps)) return;

                context.report({
                  node,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(sprinklesProps).join(', '),
                  },
                  fix: withSprinklesImport((fixer) => {
                    return fixer.replaceText(
                      node,
                      createTransformTemplate({
                        sourceCode,
                        sprinklesProps,
                        remainingProps,
                        isArrayContext: !isEmpty(remainingProps),
                      }),
                    );
                  }),
                });
              } catch (error) {}
            };

            if (variantsProperty.value.properties) {
              variantsProperty.value.properties.forEach((variantProp) => {
                if (!isObject(variantProp.value) || !variantProp.value.properties) return;

                variantProp.value.properties.forEach((valueProp) => {
                  if (isObject(valueProp.value)) {
                    const hasNoSelectors = !hasSelectors(valueProp.value.properties) && !hasNestedSelectors(valueProp.value.properties);

                    if (hasNoSelectors) {
                      directCheckVariantValue(valueProp.value);
                    }
                    return;
                  }

                  if (isArray(valueProp.value)) {
                    const elements = valueProp.value.elements || [];
                    const isSingleSprinkles = elements.length === 1 && isSprinklesCall(elements[0]);

                    if (isSingleSprinkles) {
                      context.report({
                        node: valueProp.value,
                        messageId: 'removeStyle',
                        fix(fixer) {
                          return fixer.replaceText(valueProp.value, sourceCode.getText(elements[0]));
                        },
                      });
                    } else {
                      checkArrayStylesInVariant(valueProp.value);
                    }
                  }
                });
              });
            }

            findAndCheckStylesInVariant(variantsProperty.value);
          }
        }

        // using styleVariants
        if (node.callee.name === 'styleVariants') {
          const styleVariantsArgument = node.arguments[0];

          // First argument is an object literal (basic case)
          if (isObject(styleVariantsArgument)) {
            styleVariantsArgument.properties.forEach((variantProp) => {
              const variantValue = variantProp.value;

              // Case 1: Variant is an object { primary: { background: 'blue' } }
              if (isObject(variantValue)) {
                try {
                  // Use existing hasSelectors and hasNestedSelectors checks
                  if (hasSelectors(variantValue.properties) || hasNestedSelectors(variantValue.properties)) {
                    return;
                  }

                  const { sprinklesProps, remainingProps } = separateWithConfig(variantValue.properties);

                  if (isEmpty(sprinklesProps)) {
                    return;
                  }

                  const targetProperties = Object.keys(sprinklesProps).join(', ');

                  context.report({
                    node: variantValue,
                    messageId: 'useSprinkles',
                    data: {
                      property: targetProperties,
                    },
                    fix: withSprinklesImport((fixer) => {
                      return fixer.replaceText(
                        variantValue,
                        createTransformTemplate({
                          sourceCode,
                          sprinklesProps,
                          remainingProps,
                          isArrayContext: !isEmpty(remainingProps),
                        }),
                      );
                    }),
                  });
                } catch (error) {
                  // Continue if error occurs
                }
              }

              // Case 2: Variant is an array { primary: [base, { background: 'blue' }] }
              else if (isArray(variantValue)) {
                const sprinklesCall = findSprinklesCallInArray(variantValue);
                const styleObjects = variantValue.elements.filter((el) => isObject(el) && el !== sprinklesCall);
                const variables = variantValue.elements.filter((el) => el !== sprinklesCall && isVariable(el));

                // If only using sprinkles, suggest removing style wrapper
                const hasSprinklesOnly = variantValue.elements.length === 1 && sprinklesCall;
                if (hasSprinklesOnly) {
                  context.report({
                    node: variantValue,
                    messageId: 'removeStyle',
                    fix(fixer) {
                      return fixer.replaceText(variantValue, sourceCode.getText(sprinklesCall));
                    },
                  });
                  return;
                }

                // Check if sprinkles and regular styles are properly separated
                if (sprinklesCall && styleObjects.length > 0) {
                  try {
                    const sprinklesProperties = sprinklesCall?.arguments?.[0]?.properties || [];
                    const allStyleProps = [];

                    for (const styleObject of styleObjects) {
                      if (styleObject.properties) {
                        allStyleProps.push(...styleObject.properties);
                      }
                    }

                    const isSeparatedCorrectly = checkSeparatedCorrectly({
                      sprinklesConfig,
                      shorthands: shorthands ? [...shorthands] : undefined,
                      sourceCode,
                      sprinklesProps: sprinklesProperties,
                      remainingProps: allStyleProps,
                    });

                    // Skip further checks if already properly separated
                    if (isSeparatedCorrectly) return;

                    // Additional check to avoid false positives
                    // If all sprinkles properties are already in sprinklesCall, we should skip
                    if (sprinklesProperties.length > 0) {
                      let hasUnseparatedSprinklesProperty = false;

                      for (const prop of allStyleProps) {
                        const propName = prop.key.name || prop.key.value;
                        const isDefinedInSprinkles = checkDefinedValueInSprinkles({
                          sprinklesConfig,
                          shorthands: shorthands ? [...shorthands] : undefined,
                          propName,
                          value: sourceCode.getText(prop.value),
                        });

                        if (isDefinedInSprinkles) {
                          hasUnseparatedSprinklesProperty = true;
                          break;
                        }
                      }

                      if (!hasUnseparatedSprinklesProperty) return;
                    }
                  } catch (error) {
                    // Continue if error occurs
                  }
                }

                // Collect all properties
                const allProperties = [];

                if (sprinklesCall && sprinklesCall.arguments && sprinklesCall.arguments[0]) {
                  const sprinklesProperties = sprinklesCall.arguments[0].properties || [];
                  allProperties.push(...sprinklesProperties);
                }

                for (const styleObject of styleObjects) {
                  if (styleObject.properties) {
                    allProperties.push(...styleObject.properties);
                  }
                }

                if (allProperties.length === 0) return;

                try {
                  const { sprinklesProps, remainingProps } = separateWithConfig(allProperties);

                  if (isEmpty(sprinklesProps)) return;

                  // Check if all sprinkles properties are already in sprinklesCall
                  if (sprinklesCall) {
                    const existingSprinklesProps = sprinklesCall.arguments[0].properties || [];
                    const existingSprinklesPropNames = existingSprinklesProps.map((prop) => prop.key.name || prop.key.value);

                    // Check if all sprinklesProps are already in existingSprinklesProps
                    const hasNewSprinklesProps = Object.keys(sprinklesProps).some(
                      (propName) => !existingSprinklesPropNames.includes(propName),
                    );

                    // If no new sprinkles properties need to be added, don't report
                    if (!hasNewSprinklesProps) return;
                  }

                  context.report({
                    node: variantValue,
                    messageId: 'useSprinkles',
                    data: {
                      property: listPropsMovingIntoSprinkles(sprinklesProps, sprinklesCall),
                    },
                    fix: withSprinklesImport((fixer) => {
                      return fixer.replaceText(
                        variantValue,
                        createTransformTemplate({
                          sourceCode,
                          variables,
                          sprinklesProps,
                          remainingProps,
                          isArrayContext: !(isEmpty(remainingProps) && variables.length === 0),
                        }),
                      );
                    }),
                  });
                } catch (error) {
                  // Continue if error occurs
                }
              }
            });
          }

          // Case 3: Using mapping function (second argument is a function)
          if (node.arguments.length > 1 && node.arguments[1].type === 'ArrowFunctionExpression') {
            const mapperFunction = node.arguments[1];
            const functionBody = mapperFunction.body;

            // Function body is an object
            if (isObject(functionBody)) {
              try {
                if (hasSelectors(functionBody.properties) || hasNestedSelectors(functionBody.properties)) {
                  return;
                }

                const { sprinklesProps, remainingProps } = separateWithConfig(functionBody.properties);

                if (isEmpty(sprinklesProps)) {
                  return;
                }

                const targetProperties = Object.keys(sprinklesProps).join(', ');

                context.report({
                  node: functionBody,
                  messageId: 'useSprinkles',
                  data: {
                    property: targetProperties,
                  },
                  fix: withSprinklesImport((fixer) => {
                    return fixer.replaceText(
                      functionBody,
                      createTransformTemplate({
                        sourceCode,
                        sprinklesProps,
                        remainingProps,
                        isArrayContext: !isEmpty(remainingProps),
                      }),
                    );
                  }),
                });
              } catch (error) {
                // Continue if error occurs
              }
            }
            // Function body is an array
            else if (isArray(functionBody)) {
              const sprinklesCall = findSprinklesCallInArray(functionBody);
              const styleObjects = functionBody.elements.filter((el) => isObject(el) && el !== sprinklesCall);
              const variables = functionBody.elements.filter((el) => el !== sprinklesCall && isVariable(el));

              // Collect all properties
              const allProperties = [];

              if (sprinklesCall && sprinklesCall.arguments && sprinklesCall.arguments[0]) {
                const sprinklesProperties = sprinklesCall.arguments[0].properties || [];
                allProperties.push(...sprinklesProperties);
              }

              for (const styleObject of styleObjects) {
                if (styleObject.properties) {
                  allProperties.push(...styleObject.properties);
                }
              }

              if (allProperties.length === 0) return;

              try {
                const { sprinklesProps, remainingProps } = separateWithConfig(allProperties);

                if (isEmpty(sprinklesProps)) return;

                context.report({
                  node: functionBody,
                  messageId: 'useSprinkles',
                  data: {
                    property: listPropsMovingIntoSprinkles(sprinklesProps, sprinklesCall),
                  },
                  fix: withSprinklesImport((fixer) => {
                    return fixer.replaceText(
                      functionBody,
                      createTransformTemplate({
                        sourceCode,
                        variables,
                        sprinklesProps,
                        remainingProps,
                        isArrayContext: !(isEmpty(remainingProps) && variables.length === 0),
                      }),
                    );
                  }),
                });
              } catch (error) {
                // Continue if error occurs
              }
            }
            // Function body is a block statement (more complex analysis)
            else if (functionBody.type === 'BlockStatement') {
              // Find return statement in the block
              const returnStatement = functionBody.body.find((statement) => statement.type === 'ReturnStatement');

              if (returnStatement && returnStatement.argument) {
                const returnValue = returnStatement.argument;

                // Return value is an object
                if (isObject(returnValue)) {
                  try {
                    if (hasSelectors(returnValue.properties) || hasNestedSelectors(returnValue.properties)) {
                      return;
                    }

                    const { sprinklesProps, remainingProps } = separateWithConfig(returnValue.properties);

                    if (isEmpty(sprinklesProps)) {
                      return;
                    }

                    const targetProperties = Object.keys(sprinklesProps).join(', ');

                    context.report({
                      node: returnValue,
                      messageId: 'useSprinkles',
                      data: {
                        property: targetProperties,
                      },
                      fix: withSprinklesImport((fixer) => {
                        return fixer.replaceText(
                          returnValue,
                          createTransformTemplate({
                            sourceCode,
                            sprinklesProps,
                            remainingProps,
                            isArrayContext: !isEmpty(remainingProps),
                          }),
                        );
                      }),
                    });
                  } catch (error) {
                    // Continue if error occurs
                  }
                }
                // Return value is an array
                else if (isArray(returnValue)) {
                  const sprinklesCall = findSprinklesCallInArray(returnValue);
                  const styleObjects = returnValue.elements.filter((el) => isObject(el) && el !== sprinklesCall);
                  const variables = returnValue.elements.filter((el) => el !== sprinklesCall && isVariable(el));

                  // Collect all properties
                  const allProperties = [];

                  if (sprinklesCall && sprinklesCall.arguments && sprinklesCall.arguments[0]) {
                    const sprinklesProperties = sprinklesCall.arguments[0].properties || [];
                    allProperties.push(...sprinklesProperties);
                  }

                  for (const styleObject of styleObjects) {
                    if (styleObject.properties) {
                      allProperties.push(...styleObject.properties);
                    }
                  }

                  if (allProperties.length === 0) return;

                  try {
                    const { sprinklesProps, remainingProps } = separateWithConfig(allProperties);

                    if (isEmpty(sprinklesProps)) return;

                    context.report({
                      node: returnValue,
                      messageId: 'useSprinkles',
                      data: {
                        property: listPropsMovingIntoSprinkles(sprinklesProps, sprinklesCall),
                      },
                      fix: withSprinklesImport((fixer) => {
                        return fixer.replaceText(
                          returnValue,
                          createTransformTemplate({
                            sourceCode,
                            variables,
                            sprinklesProps,
                            remainingProps,
                            isArrayContext: !(isEmpty(remainingProps) && variables.length === 0),
                          }),
                        );
                      }),
                    });
                  } catch (error) {
                    // Continue if error occurs
                  }
                }
              }
            }
          }
        }
      },
    };
  },
};
