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
            const { sprinklesProps, remainingProps } = separateProps({
              sprinklesConfig,
              shorthands,
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

              const isSeparatedCorrectly = checkSeparatedCorrectly({
                sprinklesConfig,
                shorthands,
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

              const allProperties = [...sprinklesProperties, ...nonSprinklesProperties];

              const { sprinklesProps, remainingProps } = separateProps({
                sprinklesConfig,
                shorthands,
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
              return;
            }

            if (!sprinklesCall) {
              // not use sprinkles and use only style object, but some properties have to place in sprinkles
              styleArgument.elements?.forEach((element) => {
                if (!isObject(element) || hasSelectors(element.properties)) {
                  return;
                }

                const { sprinklesProps, remainingProps } = separateProps({
                  sprinklesConfig,
                  shorthands,
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
                const { sprinklesProps, remainingProps } = separateProps({
                  sprinklesConfig,
                  shorthands,
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
                return;
              }

              if (!sprinklesCall) return;

              const isEmptySprinkles = !sprinklesCall.arguments?.[0];
              if (isEmptySprinkles) return;

              const isEmptyStyleObject = !styleObject || styleObject.properties.length === 0;
              const sprinklesProperties = sprinklesCall.arguments[0].properties;
              const remainingProperties = styleObject?.properties || [];

              const isSeparatedCorrectly = checkSeparatedCorrectly({
                sprinklesConfig,
                shorthands,
                sourceCode,
                sprinklesProps: sprinklesProperties,
                remainingProps: remainingProperties,
              });

              const isWrappedInStyle = baseProperty.value.type === 'CallExpression' && baseProperty.value.callee.name === 'style';

              if (isSeparatedCorrectly) {
                if (isWrappedInStyle) {
                  context.report({
                    node: baseProperty.value,
                    messageId: 'removeStyle',
                    data: {
                      property: 'style wrapper',
                    },
                    fix(fixer) {
                      const currentText = sourceCode.getText(baseProperty.value);
                      const match = currentText.match(/style\(\[([\s\S]*?)\]\)/);
                      if (!match) return null;

                      const arrayContent = match[1];
                      return fixer.replaceText(baseProperty.value, `[${arrayContent}]`);
                    },
                  });
                }

                const hasSprinklesOnly = targetArray.elements.length === 1 && targetArray.elements[0] === sprinklesCall;

                if (hasSprinklesOnly) {
                  context.report({
                    node: baseProperty.value,
                    messageId: 'useSprinkles',
                    data: {
                      property: 'array wrapper',
                    },
                    fix(fixer) {
                      return fixer.replaceText(baseProperty.value, sourceCode.getText(sprinklesCall));
                    },
                  });
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

              const allProperties = [...sprinklesProperties, ...remainingProperties];
              const { sprinklesProps, remainingProps } = separateProps({
                sprinklesConfig,
                shorthands,
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
            }
          }
        }
      },
    };
  },
};
