const path = require('path');
const {
  isEmpty,
  isObject,
  isArray,
  isStyleArray,
  isVariable,
  hasSelectors,
  separateProps,
  createTransformTemplate,
  findSprinklesCallInArray,
  checkSeparatedCorrectly,
} = require('./utils');

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
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useSprinkles: "🚨 '{{ property }}' is defined in Sprinkles. Use sprinkles property instead.",
      removeStyle: 'Style wrapper should be removed',
    },
    fixable: 'code',
  },

  create(context) {
    const options = context.options[0] || {};
    const configPath = options.configPath;
    const { properties: sprinklesConfig, shorthands } = require(path.resolve(process.cwd(), configPath));

    const sourceCode = context.getSourceCode();

    return {
      CallExpression(node) {
        // using style
        if (node.callee.name === 'style') {
          // if style({}), {} is node.arguments[0]
          const styleArgument = node.arguments[0];

          // Case. style({})
          if (isObject(styleArgument)) {
            try {
              const { sprinklesProps, remainingProps } = separateProps({
                sprinklesConfig,
                shorthands: shorthands ? [...shorthands] : undefined,
                properties: styleArgument.properties,
                sourceCode,
              });

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
                fix(fixer) {
                  if (isEmpty(remainingProps)) {
                    // return sprinkles only template
                    return fixer.replaceText(node, `sprinkles(${sourceCode.getText(styleArgument)})`);
                  }

                  return fixer.replaceText(
                    node,
                    createTransformTemplate({
                      sourceCode,
                      sprinklesProps,
                      remainingProps,
                    }),
                  );
                },
              });
            } catch (error) {
              // 에러 발생 시 계속 진행
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
                        return fixer.replaceText(node, sourceCode.getText(sprinklesCall));
                      },
                    });
                  }

                  return;
                }
              } catch (error) {
                // 에러 발생 시 계속 진행
              }

              const allProperties = [...sprinklesProperties, ...nonSprinklesProperties];

              try {
                const { sprinklesProps, remainingProps } = separateProps({
                  sprinklesConfig,
                  shorthands: shorthands ? [...shorthands] : undefined,
                  properties: allProperties,
                  sourceCode,
                });

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
                      if (variables.length > 0) {
                        return fixer.replaceText(node, `style({\n  ${formattedRemainingProps}\n})`);
                      } else {
                        return fixer.replaceText(
                          node,
                          `style([${variables.map((el) => sourceCode.getText(el)).join(', ')}, ${formattedRemainingProps}])`,
                        );
                      }
                    },
                  });
                  return;
                }

                const targetProperties = Object.keys(sprinklesProps).join(', ');

                context.report({
                  node,
                  messageId: 'useSprinkles',
                  data: {
                    property: targetProperties,
                  },
                  fix(fixer) {
                    return fixer.replaceText(
                      node,
                      createTransformTemplate({
                        sourceCode,
                        variables,
                        sprinklesProps,
                        remainingProps,
                      }),
                    );
                  },
                });
              } catch (error) {
                // 에러 발생 시 계속 진행
              }
              return;
            }

            if (!sprinklesCall) {
              // not use sprinkles and use only style object, but some properties have to place in sprinkles
              styleArgument.elements?.forEach((element) => {
                if (!isObject(element) || hasSelectors(element.properties)) {
                  return;
                }

                try {
                  const { sprinklesProps, remainingProps } = separateProps({
                    sprinklesConfig,
                    shorthands: shorthands ? [...shorthands] : undefined,
                    properties: element.properties,
                    sourceCode,
                  });

                  if (isEmpty(sprinklesProps)) {
                    return;
                  }

                  const targetProperties = Object.keys(sprinklesProps).join(', ');

                  context.report({
                    node: element,
                    messageId: 'useSprinkles',
                    data: {
                      property: targetProperties,
                    },
                    fix(fixer) {
                      return fixer.replaceText(
                        element,
                        createTransformTemplate({
                          sourceCode,
                          variables,
                          sprinklesProps,
                          remainingProps,
                        }),
                      );
                    },
                  });
                } catch (error) {
                  // 에러 발생 시 계속 진행
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
              const variables = targetArray.elements.filter((el) => el !== sprinklesCall && isVariable(el));
              const styleObject = targetArray.elements.find((element) => isObject(element));

              if (!sprinklesCall && styleObject) {
                try {
                  const { sprinklesProps, remainingProps } = separateProps({
                    sprinklesConfig,
                    shorthands: shorthands ? [...shorthands] : undefined,
                    properties: styleObject.properties,
                    sourceCode,
                  });

                  if (!isEmpty(sprinklesProps)) {
                    context.report({
                      node: styleObject,
                      messageId: 'useSprinkles',
                      data: {
                        property: Object.keys(sprinklesProps).join(', '),
                      },
                      fix(fixer) {
                        return fixer.replaceText(
                          baseProperty.value,
                          createTransformTemplate({
                            sourceCode,
                            variables,
                            sprinklesProps,
                            remainingProps,
                            isArrayContext: true,
                          }),
                        );
                      },
                    });
                  }
                } catch (error) {
                  // 에러 발생 시 계속 진행
                }
                return;
              }

              if (isEmptyStyleObject) {
                context.report({
                  node: baseProperty.value,
                  messageId: 'useSprinkles',
                  data: {
                    property: 'all',
                  },
                  fix(fixer) {
                    if (variables.length > 0) {
                      const elements = [...variables, sprinklesCall];
                      return fixer.replaceText(baseProperty.value, `[${elements.map((el) => sourceCode.getText(el)).join(', ')}]`);
                    }
                    return fixer.replaceText(baseProperty.value, sourceCode.getText(sprinklesCall));
                  },
                });
                return;
              }

              const sprinklesProperties = sprinklesCall.arguments[0].properties;
              const remainingProperties = styleObject?.properties || [];

              try {
                const isSeparatedCorrectly = checkSeparatedCorrectly({
                  sprinklesConfig,
                  shorthands: shorthands ? [...shorthands] : undefined,
                  sourceCode,
                  sprinklesProps: sprinklesProperties,
                  remainingProps: remainingProperties,
                });

                // if sprinkles and nonSprinkles are separated correctly, return instantly
                if (isSeparatedCorrectly) {
                  const hasSprinklesOnly = styleArgument.elements.length === 1 && styleArgument.elements[0] === sprinklesCall;
                  if (hasSprinklesOnly) {
                    context.report({
                      node,
                      messageId: 'removeStyle',
                      fix(fixer) {
                        return fixer.replaceText(node, sourceCode.getText(sprinklesCall));
                      },
                    });
                  }

                  return;
                }
              } catch (error) {
                // 에러 발생 시 계속 진행
              }

              const allProperties = [...sprinklesProperties, ...remainingProperties];
              try {
                const { sprinklesProps, remainingProps } = separateProps({
                  sprinklesConfig,
                  shorthands: shorthands ? [...shorthands] : undefined,
                  properties: allProperties,
                  sourceCode,
                });

                const targetProperties = Object.keys(sprinklesProps).join(', ');

                if (!isEmpty(sprinklesProps)) {
                  context.report({
                    node: baseProperty.value,
                    messageId: 'useSprinkles',
                    data: {
                      property: targetProperties,
                    },
                    fix(fixer) {
                      if (styleObject.properties.length === 0 && variables.length === 0) {
                        return fixer.replaceText(baseProperty.value, sourceCode.getText(sprinklesCall));
                      }

                      return fixer.replaceText(
                        baseProperty.value,
                        createTransformTemplate({
                          sourceCode,
                          variables,
                          sprinklesProps,
                          remainingProps,
                          isArrayContext: true,
                        }),
                      );
                    },
                  });
                }
              } catch (error) {
                // 에러 발생 시 계속 진행
              }
            }
          }

          /** variants in recipe */
          const variantsProperty = recipeArgument.properties.find((prop) => prop.key.name === 'variants');

          if (variantsProperty && isObject(variantsProperty.value)) {
            // all object in variants check recursivly
            const checkVariantStyles = (node) => {
              if (!isObject(node)) return;

              try {
                const { sprinklesProps, remainingProps } = separateProps({
                  sprinklesConfig,
                  shorthands: shorthands ? [...shorthands] : undefined,
                  properties: node.properties,
                  sourceCode,
                });

                if (!isEmpty(sprinklesProps)) {
                  context.report({
                    node,
                    messageId: 'useSprinkles',
                    data: {
                      property: Object.keys(sprinklesProps).join(', '),
                    },
                    fix(fixer) {
                      return fixer.replaceText(
                        node,
                        createTransformTemplate({
                          sourceCode,
                          sprinklesProps,
                          remainingProps,
                        }),
                      );
                    },
                  });
                }
              } catch (error) {
                // 에러 발생 시 계속 진행
              }
            };

            const findAndCheckStyles = (node) => {
              if (!node.properties) return;

              checkVariantStyles(node);

              node.properties.forEach((prop) => {
                if (isObject(prop.value)) {
                  findAndCheckStyles(prop.value);
                }
              });
            };

            findAndCheckStyles(variantsProperty.value);
          }
        }
      },
    };
  },
};
