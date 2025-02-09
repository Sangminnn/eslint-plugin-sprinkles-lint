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
          const firstArg = node.arguments[0];

          if (isObjectExpression(firstArg)) {
            const getPropsFunction = hasSelectors(firstArg.properties)
              ? getPropsInObjectCaseWithSelector
              : getPropsInObjectCaseWithoutSelector;

            const { sprinklesProps, remainingProps } = getPropsFunction({
              sprinklesConfig,
              properties: firstArg.properties,
              sourceCode,
            });

            if (Object.keys(sprinklesProps).length === 0) {
              return;
            }

            context.report({
              node: firstArg,
              messageId: 'useSprinkles',
              data: {
                property: Object.keys(sprinklesProps).join(', '),
              },
              fix(fixer) {
                return fixer.replaceText(
                  firstArg,
                  createSprinklesTransform({
                    sprinklesProps,
                    remainingProps,
                  }),
                );
              },
            });
          }

          if (isArrayExpression(firstArg)) {
            if (firstArg.elements[0]?.type === 'CallExpression' && firstArg.elements[0].callee.name === 'sprinkles') {
              const sprinklesCall = firstArg.elements[0];
              if (!sprinklesCall.arguments?.[0]) return;

              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                sprinklesConfig,
                properties: sprinklesCall.arguments[0].properties,
                sourceCode,
              });

              // sprinkles에 정의되지 않은 속성이 있으면 에러 보고
              if (Object.keys(remainingProps).length > 0) {
                context.report({
                  node: firstArg,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(remainingProps).join(', '),
                  },
                  fix(fixer) {
                    if (
                      firstArg.elements.length === 2 &&
                      isObjectExpression(firstArg.elements[1]) &&
                      firstArg.elements[1].properties.length === 0
                    ) {
                      // style([sprinkles(...), {}]) => sprinkles(...)
                      return fixer.replaceText(node, sourceCode.getText(sprinklesCall));
                    }

                    // 그 외의 경우는 remainingProps를 두 번째 객체로 이동
                    return fixer.replaceText(
                      firstArg,
                      createSprinklesTransform({
                        sprinklesProps,
                        remainingProps,
                      }),
                    );
                  },
                });
                return;
              }

              // sprinkles만 있고 빈 객체가 있는 경우
              if (
                firstArg.elements.length === 2 &&
                isObjectExpression(firstArg.elements[1]) &&
                firstArg.elements[1].properties.length === 0
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

            firstArg.elements?.forEach((element) => {
              if (isObjectExpression(element)) {
                if (hasSelectors(element.properties)) {
                  return;
                }

                const existingSprinklesCalls = firstArg.elements.filter(
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

                    // 기존 요소들 (flexCenter 등)
                    const existingElements = firstArg.elements
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
              // if use style in base, wrap to array
              if (
                baseProperty.value.type === 'CallExpression' &&
                baseProperty.value.callee.name === 'style' &&
                baseProperty.value.arguments[0]?.type === 'ArrayExpression'
              ) {
                const arrayContent = sourceCode.getText(baseProperty.value.arguments[0]);

                context.report({
                  node: baseProperty.value,
                  messageId: 'useSprinkles',
                  fix(fixer) {
                    return fixer.replaceText(baseProperty.value, arrayContent);
                  },
                });
                return;
              }

              // 배열 형태 검증 및 처리
              if (isArrayExpression(baseProperty.value)) {
                const elements = baseProperty.value.elements;
                const firstElement = elements[0];
                const secondElement = elements[1];

                // if first element is sprinkles call and second element is object,
                /**
                 * recipe({
                 *  base: [
                 *    sprinkles({
                 *      position: 'absolute',
                 *    }),
                 *    {
                 *      position: 'absolute',
                 *    }
                 *  ]
                 * })
                 */

                const isSprinklesCall =
                  firstElement?.type === 'CallExpression' &&
                  firstElement?.callee.name === 'sprinkles' &&
                  firstElement?.arguments?.[0]?.type === 'ObjectExpression';
                const hasObjectExpression = secondElement?.type === 'ObjectExpression';

                if (isSprinklesCall && hasObjectExpression) {
                  // check sprinkles properties in object (second element)
                  const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                    sprinklesConfig,
                    properties: secondElement.properties,
                    sourceCode,
                  });

                  if (Object.keys(sprinklesProps).length > 0) {
                    context.report({
                      node: baseProperty.value,
                      messageId: 'useSprinkles',
                      data: {
                        property: Object.keys(sprinklesProps).join(', '),
                      },
                      fix(fixer) {
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
                  return;
                }
              }

              // 그 외의 경우 변환
              const sprinklesPropsMap = new Map();
              const remainingPropsMap = new Map();

              const divideSprinklesAndRemainingProps = (properties) => {
                const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                  sprinklesConfig,
                  properties,
                  sourceCode,
                });

                Object.entries(sprinklesProps).forEach(([key, value]) => {
                  sprinklesPropsMap.set(key, value);
                });

                Object.entries(remainingProps).forEach(([key, value]) => {
                  remainingPropsMap.set(key, value);
                });
              };

              if (isArrayExpression(baseProperty.value)) {
                baseProperty.value.elements.forEach((element) => {
                  if (isObjectExpression(element)) {
                    divideSprinklesAndRemainingProps(element.properties);
                  }
                });
              } else if (isObjectExpression(baseProperty.value)) {
                divideSprinklesAndRemainingProps(baseProperty.value.properties);
              }

              if (sprinklesPropsMap.size === 0) {
                return;
              }

              context.report({
                node: baseProperty.value,
                messageId: 'useSprinkles',
                data: {
                  property: Array.from(sprinklesPropsMap.keys()).join(', '),
                },
                fix(fixer) {
                  return fixer.replaceText(
                    baseProperty.value,
                    createSprinklesTransform({
                      sprinklesProps: Object.fromEntries(sprinklesPropsMap),
                      remainingProps: Object.fromEntries(remainingPropsMap),
                    }),
                  );
                },
              });
            }

            // variants
            const variantsProperty = firstArg.properties.find((prop) => prop.key.name === 'variants');

            if (variantsProperty && isObjectExpression(variantsProperty.value)) {
              variantsProperty.value.properties.forEach((variantProp) => {
                if (!isObjectExpression(variantProp.value)) {
                  return;
                }

                Object.values(variantProp.value.properties).forEach((variantValue) => {
                  if (isObjectExpression(variantValue.value)) {
                    const isStyleCall = variantValue.value.type === 'CallExpression' && variantValue.value.callee.name === 'style';
                    const hasArrayArgument = variantValue.value.arguments[0]?.type === 'ArrayExpression';

                    if (isStyleCall && hasArrayArgument) {
                      const arrayContent = sourceCode.getText(variantValue.value.arguments[0]);
                      context.report({
                        node: variantValue.value,
                        messageId: 'useSprinkles',
                        fix(fixer) {
                          return fixer.replaceText(variantValue.value, arrayContent);
                        },
                      });
                      return;
                    }

                    if (isArrayExpression(variantValue.value)) {
                      const elements = variantValue.value.elements;
                      const firstElement = elements[0];
                      const secondElement = elements[1];

                      const isSprinklesCall =
                        firstElement?.type === 'CallExpression' &&
                        firstElement?.callee.name === 'sprinkles' &&
                        firstElement?.arguments?.[0]?.type === 'ObjectExpression';

                      const hasObjectExpression = secondElement?.type === 'ObjectExpression';

                      if (isSprinklesCall && hasObjectExpression) {
                        const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                          sprinklesConfig,
                          properties: secondElement.properties,
                          sourceCode,
                        });

                        if (Object.keys(sprinklesProps).length === 0) {
                          return;
                        }

                        context.report({
                          node: variantValue.value,
                          messageId: 'useSprinkles',
                          data: {
                            property: Object.keys(sprinklesProps).join(', '),
                          },
                          fix(fixer) {
                            return fixer.replaceText(
                              variantValue.value,
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

                    const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                      sprinklesConfig,
                      properties: variantValue.value.properties,
                      sourceCode,
                    });

                    if (Object.keys(sprinklesProps).length === 0) {
                      return;
                    }

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
                });
              });
            }
          }
        }
      },
    };
  },
};
