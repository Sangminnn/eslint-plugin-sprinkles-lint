const path = require('path');
const {
  isObjectExpression,
  isArrayExpression,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  hasSelectors,
  createSprinklesTransform,
  mergeSprinklesInArrayForm,
  mergeSprinklesWithExistingElements,
  findSprinklesCallInArray,
  hasEmptyObjectInArray,
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
          configPath: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useSprinkles: "🚨 '{{ property }}' is defined in Sprinkles. Use sprinkles property instead.",
    },
    fixable: 'code',
  },

  create(context) {
    const options = context.options[0] || {};
    const configPath = options.configPath;
    const sprinklesConfig = configPath ? require(path.resolve(process.cwd(), configPath)) : options.sprinklesConfig;

    return {
      CallExpression(node) {
        // using style
        if (node.callee.name === 'style') {
          const sourceCode = context.getSourceCode();
          const styleArgument = node.arguments[0];

          if (isObjectExpression(styleArgument)) {
            const getPropsFunction = hasSelectors(styleArgument.properties)
              ? getPropsInObjectCaseWithSelector
              : getPropsInObjectCaseWithoutSelector;

            const { sprinklesProps, remainingProps } = getPropsFunction({
              sprinklesConfig,
              properties: styleArgument.properties,
              sourceCode,
            });

            if (Object.keys(sprinklesProps).length === 0) {
              return;
            }

            context.report({
              node: styleArgument,
              messageId: 'useSprinkles',
              data: {
                property: Object.keys(sprinklesProps).join(', '),
              },
              fix(fixer) {
                if (Object.keys(remainingProps).length === 0) {
                  // return sprinkles only template
                  return fixer.replaceText(node, `sprinkles(${sourceCode.getText(styleArgument)})`);
                }

                return fixer.replaceText(
                  styleArgument,
                  createSprinklesTransform({
                    sprinklesProps,
                    remainingProps,
                  }),
                );
              },
            });
          }

          if (isArrayExpression(styleArgument)) {
            const sprinklesCall = findSprinklesCallInArray(styleArgument);
            const isEmptySprinkles = !sprinklesCall.arguments?.[0];

            if (sprinklesCall) {
              if (isEmptySprinkles) return;

              const nonSprinklesObject = styleArgument.elements.find((element) => isObjectExpression(element));

              const allProperties = [...sprinklesCall.arguments[0].properties, ...nonSprinklesObject.properties];

              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                sprinklesConfig,
                properties: allProperties,
                sourceCode,
              });

              const isSeparatedCorrectly =
                sprinklesCall.arguments[0].properties.every((prop) => prop.key.name in sprinklesProps) &&
                nonSprinklesObject.properties.every((prop) => prop.key.name in remainingProps);

              if (isSeparatedCorrectly) {
                return;
              }

              // style([sprinkles(...), {}]) => sprinkles(...)
              if (hasEmptyObjectInArray(styleArgument)) {
                if (Object.keys(sprinklesProps).length === 0) {
                  const remainingPropsString = Object.entries(remainingProps)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(',\n  ');

                  context.report({
                    node: node,
                    messageId: 'useSprinkles',
                    data: {
                      property: 'all',
                    },
                    fix(fixer) {
                      return fixer.replaceText(node, `style({\n  ${remainingPropsString}\n})`);
                    },
                  });
                  return;
                }

                if (Object.keys(remainingProps).length === 0) {
                  context.report({
                    node: node,
                    messageId: 'useSprinkles',
                    data: {
                      property: 'all',
                    },
                    fix(fixer) {
                      return fixer.replaceText(node, sourceCode.getText(sprinklesCall));
                    },
                  });
                  return;
                }
              }

              if (Object.keys(remainingProps).length > 0) {
                context.report({
                  node: styleArgument,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(remainingProps).join(', '),
                  },
                  fix(fixer) {
                    if (hasEmptyObjectInArray(styleArgument) && Object.keys(remainingProps).length === 0) {
                      return fixer.replaceText(node, sourceCode.getText(sprinklesCall));
                    }

                    return fixer.replaceText(
                      styleArgument,
                      createSprinklesTransform({
                        sprinklesProps,
                        remainingProps,
                      }),
                    );
                  },
                });
                return;
              }
            }

            styleArgument.elements?.forEach((element) => {
              if (isObjectExpression(element)) {
                if (hasSelectors(element.properties)) {
                  return;
                }

                const existingSprinklesCalls = styleArgument.elements.filter(
                  (el) => el.type === 'CallExpression' && el.callee.name === 'sprinkles' && el.arguments?.[0]?.type === 'ObjectExpression',
                );

                const { sprinklesProps, remainingProps } = getPropsInArrayCase({
                  sprinklesConfig,
                  element,
                  sourceCode,
                });

                if (Object.keys(sprinklesProps).length === 0) {
                  return;
                }

                context.report({
                  node: element,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(sprinklesProps).join(', '),
                  },
                  fix(fixer) {
                    if (existingSprinklesCalls.length === 0) {
                      return fixer.replaceText(
                        element,
                        createSprinklesTransform({
                          sprinklesProps,
                          remainingProps,
                        }),
                      );
                    }

                    const existingElements = styleArgument.elements
                      .filter((el) => !(el.type === 'CallExpression' && el.callee.name === 'sprinkles') && el !== element)
                      .map((el) => sourceCode.getText(el));

                    return fixer.replaceText(
                      element,
                      mergeSprinklesWithExistingElements({
                        sourceCode,
                        existingSprinklesCalls,
                        sprinklesProps,
                        remainingProps,
                        existingElements,
                      }),
                    );
                  },
                });
              }
            });
          }
        }

        // using recipe
        if (node.callee.name === 'recipe') {
          const sourceCode = context.getSourceCode();
          const recipeArgument = node.arguments[0];
          const baseProperty = recipeArgument.properties.find((prop) => prop.key.name === 'base');

          /** base in recipe */
          if (baseProperty && isArrayExpression(baseProperty.value)) {
            const sprinklesCall = findSprinklesCallInArray(baseProperty.value);

            if (sprinklesCall) {
              const isEmptySprinkles = !sprinklesCall.arguments?.[0];
              if (isEmptySprinkles) return;

              const styleObject = baseProperty.value.elements.find((element) => isObjectExpression(element));

              if (styleObject) {
                const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                  sprinklesConfig,
                  properties: styleObject.properties,
                  sourceCode,
                });

                if (Object.keys(sprinklesProps).length > 0 || styleObject.properties.length === 0) {
                  context.report({
                    node: styleObject,
                    messageId: 'useSprinkles',
                    data: {
                      property: Object.keys(sprinklesProps).join(', '),
                    },
                    fix(fixer) {
                      if (styleObject.properties.length === 0) {
                        return fixer.replaceText(baseProperty.value, sourceCode.getText(sprinklesCall));
                      }

                      return fixer.replaceText(
                        baseProperty.value,
                        mergeSprinklesInArrayForm({
                          sourceCode,
                          target: sprinklesCall,
                          sprinklesProps,
                          remainingProps,
                        }),
                      );
                    },
                  });
                }
              }
            }
          }

          /** variants in recipe */
          const variantsProperty = recipeArgument.properties.find((prop) => prop.key.name === 'variants');

          if (variantsProperty && isObjectExpression(variantsProperty.value)) {
            // variants의 모든 객체를 재귀적으로 처리하는 함수
            const checkVariantStyles = (node) => {
              if (!isObjectExpression(node)) return;

              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                sprinklesConfig,
                properties: node.properties,
                sourceCode,
              });

              if (Object.keys(sprinklesProps).length > 0) {
                context.report({
                  node: node,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(sprinklesProps).join(', '),
                  },
                  fix(fixer) {
                    return fixer.replaceText(
                      node,
                      createSprinklesTransform({
                        sprinklesProps,
                        remainingProps,
                      }),
                    );
                  },
                });
              }
            };

            // variants의 모든 중첩된 객체를 처리
            const findAndCheckStyles = (node) => {
              if (!node.properties) return;

              node.properties.forEach((prop) => {
                if (isObjectExpression(prop.value)) {
                  checkVariantStyles(prop.value);
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
