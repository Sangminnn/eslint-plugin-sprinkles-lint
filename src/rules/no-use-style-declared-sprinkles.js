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

              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                sprinklesConfig,
                properties: sprinklesCall.arguments[0].properties,
                sourceCode,
              });

              // sprinkles에 정의되지 않은 속성이 있으면 에러 보고
              if (Object.keys(remainingProps).length > 0) {
                context.report({
                  node: styleArgument,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(remainingProps).join(', '),
                  },
                  fix(fixer) {
                    if (sprinklesCall && hasEmptyObjectInArray(styleArgument)) {
                      // style([sprinkles(...), {}]) => sprinkles(...)
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

              /**
               * Case
               *
               * style([
               *  sprinkles({ color: 'red' }),
               *  {}
               * ])
               *
               */
              if (
                styleArgument.elements.length === 2 &&
                isObjectExpression(styleArgument.elements[1]) &&
                styleArgument.elements[1].properties.length === 0
              ) {
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
          const firstArg = node.arguments[0];

          if (isObjectExpression(firstArg)) {
            // base in recipe
            const baseProperty = firstArg.properties.find((prop) => prop.key.name === 'base');

            if (baseProperty) {
              if (isArrayExpression(baseProperty.value)) {
                const elements = baseProperty.value.elements;
                const firstElement = elements[0];
                const secondElement = elements[1];

                const hasSprinklesCall =
                  firstElement?.type === 'CallExpression' &&
                  firstElement?.callee.name === 'sprinkles' &&
                  firstElement?.arguments?.[0]?.type === 'ObjectExpression';

                /**
                 * Case
                 *
                 * [sprinkles(...), {}]
                 */
                if (hasSprinklesCall && isObjectExpression(secondElement)) {
                  const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                    sprinklesConfig,
                    properties: secondElement.properties,
                    sourceCode,
                  });

                  if (Object.keys(sprinklesProps).length > 0 || secondElement.properties.length === 0) {
                    context.report({
                      node: secondElement,
                      messageId: 'useSprinkles',
                      data: {
                        property: Object.keys(sprinklesProps).join(', '),
                      },
                      fix(fixer) {
                        if (secondElement.properties.length === 0) {
                          return fixer.replaceText(baseProperty.value, sourceCode.getText(firstElement));
                        }

                        return fixer.replaceText(
                          baseProperty.value,
                          mergeSprinklesInArrayForm({
                            sourceCode,
                            firstElement,
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

            // variants
            const variantsProperty = firstArg.properties.find((prop) => prop.key.name === 'variants');

            if (variantsProperty && isObjectExpression(variantsProperty.value)) {
              variantsProperty.value.properties.forEach((variantProp) => {
                if (!isObjectExpression(variantProp.value)) return;

                Object.values(variantProp.value.properties).forEach((variantValue) => {
                  if (isObjectExpression(variantValue.value)) {
                    const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                      sprinklesConfig,
                      properties: variantValue.value.properties,
                      sourceCode,
                    });

                    if (Object.keys(sprinklesProps).length > 0) {
                      context.report({
                        node: variantValue.value,
                        messageId: 'useSprinkles',
                        data: {
                          property: Object.keys(sprinklesProps).join(', '),
                        },
                        fix(fixer) {
                          return fixer.replaceText(
                            variantValue.value,
                            createSprinklesTransform({
                              sprinklesProps,
                              remainingProps,
                            }),
                          );
                        },
                      });
                    }
                  }
                });
              });
            }
          }
        }
      },
    };
  },
};
