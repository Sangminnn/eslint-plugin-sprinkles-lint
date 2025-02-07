const path = require('path');
const {
  isObjectExpression,
  isArrayExpression,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  hasSelectors,
  isSelector,
  isValidArrayForm,
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
            if (hasSelectors(firstArg.properties)) {
              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithSelector({
                sprinklesConfig,
                properties: firstArg.properties,
                sourceCode,
              });

              if (Object.keys(sprinklesProps).length > 0) {
                context.report({
                  node: firstArg,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(sprinklesProps).join(', '),
                  },
                  fix(fixer) {
                    const sprinklesObj = `sprinkles({
                      ${Object.entries(sprinklesProps)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(',\n    ')}
                    })`;

                    // remainingProps가 없으면 sprinkles만 반환
                    if (Object.keys(remainingProps).length === 0) {
                      return fixer.replaceText(node, sprinklesObj);
                    }

                    const remainingObj = `{
                      ${Object.entries(remainingProps)
                        .map(([key, value]) => `${isSelector(key) ? `'${key}'` : key}: ${value}`)
                        .join(',\n    ')}
                    }`;

                    const newCode = `[${[sprinklesObj, remainingObj].filter(Boolean).join(',\n  ')}]`;

                    return fixer.replaceText(firstArg, newCode);
                  },
                });
              }
            } else {
              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                sprinklesConfig,
                properties: firstArg.properties,
                sourceCode,
              });

              if (Object.keys(sprinklesProps).length > 0) {
                context.report({
                  node: firstArg,
                  messageId: 'useSprinkles',
                  data: {
                    property: Object.keys(sprinklesProps).join(', '),
                  },
                  fix(fixer) {
                    const sprinklesObj = `sprinkles({
                      ${Object.entries(sprinklesProps)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(',\n    ')}
                    })`;

                    // remainingProps가 없으면 sprinkles만 반환
                    if (Object.keys(remainingProps).length === 0) {
                      return fixer.replaceText(node, sprinklesObj);
                    }

                    const remainingObj = Object.keys(remainingProps).length
                      ? `{
                        ${Object.entries(remainingProps)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(',\n    ')}
                      }`
                      : '';

                    const newCode = `[${[sprinklesObj, remainingObj].filter(Boolean).join(',\n  ')}]`;

                    return fixer.replaceText(firstArg, newCode);
                  },
                });
              }
            }
          } else if (isArrayExpression(firstArg)) {
            if (
              firstArg.elements.length === 1 &&
              firstArg.elements[0].type === 'CallExpression' &&
              firstArg.elements[0].callee.name === 'sprinkles'
            ) {
              return context.report({
                node: node,
                messageId: 'useSprinkles',
                data: {
                  property: 'all',
                },
                fix(fixer) {
                  return fixer.replaceText(node, sourceCode.getText(firstArg.elements[0]));
                },
              });
            }

            firstArg.elements?.forEach((element) => {
              if (isObjectExpression(element)) {
                if (hasSelectors(element.properties)) {
                  return;
                }

                const existingSprinklesCalls = firstArg.elements.filter(
                  (el) => el.type === 'CallExpression' && el.callee.name === 'sprinkles',
                );

                const { sprinklesProps, remainingProps } = getPropsInArrayCase({
                  sprinklesConfig,
                  element,
                  sourceCode,
                });

                if (Object.keys(sprinklesProps).length > 0) {
                  context.report({
                    node: element,
                    messageId: 'useSprinkles',
                    data: {
                      property: Object.keys(sprinklesProps).join(', '),
                    },
                    fix(fixer) {
                      if (existingSprinklesCalls.length > 0) {
                        // Map을 사용하여 중복 속성 관리
                        const sprinklesPropsMap = new Map();
                        const remainingPropsMap = new Map();

                        // 기존 sprinkles 속성들 Map에 추가
                        existingSprinklesCalls.forEach((call) => {
                          const props = sourceCode.getText(call.arguments[0]);
                          const propsText = props.slice(1, -1).trim();
                          const propPairs = propsText.split(',').map((pair) => pair.trim());
                          propPairs.forEach((pair) => {
                            if (pair) {
                              const [key, value] = pair.split(':').map((part) => part.trim());
                              sprinklesPropsMap.set(key, value);
                            }
                          });
                        });

                        // 새로운 속성들을 sprinkles와 remaining으로 분류
                        Object.entries(sprinklesProps).forEach(([key, value]) => {
                          sprinklesPropsMap.set(key, value);
                        });

                        Object.entries(remainingProps).forEach(([key, value]) => {
                          remainingPropsMap.set(key, value);
                        });

                        const mergedSprinklesObj = `sprinkles({
                          ${Array.from(sprinklesPropsMap.entries())
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(',\n    ')}
                        })`;

                        // 1. 기존 요소들 (flexCenter 등)
                        const existingElements = firstArg.elements
                          .filter((el) => !(el.type === 'CallExpression' && el.callee.name === 'sprinkles') && el !== element)
                          .map((el) => sourceCode.getText(el));

                        // 2. 남은 스타일 객체
                        const remainingObj =
                          remainingPropsMap.size > 0
                            ? `{
                            ${Array.from(remainingPropsMap.entries())
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(',\n    ')}
                          }`
                            : '';

                        // 다른 요소들이 없고 remainingProps도 없다면 sprinkles만 반환
                        if (existingElements.length === 0 && !remainingObj) {
                          return fixer.replaceText(node, mergedSprinklesObj);
                        }

                        // 그 외의 경우는 배열로 처리
                        const newElements = [...existingElements, mergedSprinklesObj, ...(remainingObj ? [remainingObj] : [])];

                        return fixer.replaceText(firstArg, `[${newElements.join(',\n  ')}]`);
                      } else {
                        const sprinklesObj = `sprinkles({
                          ${Object.entries(sprinklesProps)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(',\n    ')}
                        })`;

                        // remainingProps가 없으면 sprinkles만 반환
                        if (Object.keys(remainingProps).length === 0) {
                          return fixer.replaceText(node, sprinklesObj);
                        }

                        const remainingObj = Object.keys(remainingProps).length
                          ? `{
                          ${Object.entries(remainingProps)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(',\n    ')}
                        }`
                          : '';

                        const newCode = [sprinklesObj, remainingObj].filter(Boolean).join(',\n  ');

                        return fixer.replaceText(element, newCode);
                      }
                    },
                  });
                }
              }
            });
          }
        }

        // using recipe
        if (node.callee.name === 'recipe') {
          const sourceCode = context.getSourceCode();
          const firstArg = node.arguments[0];

          if (isObjectExpression(firstArg)) {
            const baseProperty = firstArg.properties.find((prop) => prop.key.name === 'base');

            if (baseProperty) {
              // style() 호출을 배열로 변환
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

                // 첫 번째 요소가 sprinkles 호출이고 두 번째 요소가 객체인 경우
                if (
                  firstElement?.type === 'CallExpression' &&
                  firstElement?.callee.name === 'sprinkles' &&
                  isObjectExpression(secondElement)
                ) {
                  // 두 번째 객체에서 sprinkles 속성 확인
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
                        // 기존 sprinkles 호출의 속성들 가져오기
                        const existingSprinklesProps = sourceCode.getText(firstElement.arguments[0]);
                        const existingProps = existingSprinklesProps
                          .slice(1, -1) // 중괄호 제거
                          .split(',')
                          .map((prop) => prop.trim())
                          .filter((prop) => prop.length > 0) // 빈 문자열 제거
                          .join(',\n    ');

                        const sprinklesObj = `sprinkles({
            ${existingProps}${Object.keys(sprinklesProps).length ? ',' : ''}
            ${Object.entries(sprinklesProps)
              .map(([key, value]) => `${key}: ${value}`)
              .join(',\n    ')}
          })`;

                        const remainingObj = `{
            ${Object.entries(remainingProps)
              .map(([key, value]) => {
                const formattedKey = isSelector(key) ? `'${key}'` : key;
                return `${formattedKey}: ${value}`;
              })
              .join(',\n    ')}
          }`;

                        return fixer.replaceText(baseProperty.value, `[\n  ${sprinklesObj},\n  ${remainingObj}\n]`);
                      },
                    });
                  }
                  return;
                }
              }

              // 그 외의 경우 변환
              if (isArrayExpression(baseProperty.value) || isObjectExpression(baseProperty.value)) {
                const sprinklesPropsMap = new Map();
                const remainingPropsMap = new Map();

                if (isArrayExpression(baseProperty.value)) {
                  baseProperty.value.elements.forEach((element) => {
                    if (isObjectExpression(element)) {
                      const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                        sprinklesConfig,
                        properties: element.properties,
                        sourceCode,
                      });

                      Object.entries(sprinklesProps).forEach(([key, value]) => {
                        sprinklesPropsMap.set(key, value);
                      });

                      Object.entries(remainingProps).forEach(([key, value]) => {
                        remainingPropsMap.set(key, value);
                      });
                    }
                  });
                } else if (isObjectExpression(baseProperty.value)) {
                  const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                    sprinklesConfig,
                    properties: baseProperty.value.properties,
                    sourceCode,
                  });

                  Object.entries(sprinklesProps).forEach(([key, value]) => {
                    sprinklesPropsMap.set(key, value);
                  });

                  Object.entries(remainingProps).forEach(([key, value]) => {
                    remainingPropsMap.set(key, value);
                  });
                }

                if (sprinklesPropsMap.size > 0) {
                  context.report({
                    node: baseProperty.value,
                    messageId: 'useSprinkles',
                    data: {
                      property: Array.from(sprinklesPropsMap.keys()).join(', '),
                    },
                    fix(fixer) {
                      const sprinklesEntries = Array.from(sprinklesPropsMap.entries())
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(',\n    ');

                      const sprinklesObj = `sprinkles({
            ${sprinklesEntries}
          })`;

                      if (remainingPropsMap.size === 0) {
                        return fixer.replaceText(baseProperty.value, sprinklesObj);
                      }

                      const remainingEntries = Array.from(remainingPropsMap.entries())
                        .map(([key, value]) => {
                          const formattedKey = isSelector(key) ? `'${key}'` : key;
                          return `${formattedKey}: ${value}`;
                        })
                        .join(',\n    ');

                      const remainingObj = `{
            ${remainingEntries}
          }`;

                      return fixer.replaceText(baseProperty.value, `[\n  ${sprinklesObj},\n  ${remainingObj}\n]`);
                    },
                  });
                }
              }
            }

            // variants 처리
            const variantsProperty = firstArg.properties.find((prop) => prop.key.name === 'variants');

            if (variantsProperty && isObjectExpression(variantsProperty.value)) {
              variantsProperty.value.properties.forEach((variantProp) => {
                if (isObjectExpression(variantProp.value)) {
                  Object.values(variantProp.value.properties).forEach((variantValue) => {
                    if (isObjectExpression(variantValue.value)) {
                      // style() 호출을 배열로 변환
                      if (
                        variantValue.value.type === 'CallExpression' &&
                        variantValue.value.callee.name === 'style' &&
                        variantValue.value.arguments[0]?.type === 'ArrayExpression'
                      ) {
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

                      // 배열 형태 검증 및 처리
                      if (isArrayExpression(variantValue.value)) {
                        const elements = variantValue.value.elements;
                        const firstElement = elements[0];
                        const secondElement = elements[1];

                        if (
                          firstElement?.type === 'CallExpression' &&
                          firstElement?.callee.name === 'sprinkles' &&
                          isObjectExpression(secondElement)
                        ) {
                          const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                            sprinklesConfig,
                            properties: secondElement.properties,
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
                                const existingSprinklesProps = sourceCode.getText(firstElement.arguments[0]);
                                const existingProps = existingSprinklesProps
                                  .slice(1, -1)
                                  .split(',')
                                  .map((prop) => prop.trim())
                                  .filter((prop) => prop.length > 0)
                                  .join(',\n    ');

                                const sprinklesObj = `sprinkles({
            ${existingProps}${Object.keys(sprinklesProps).length ? ',' : ''}
            ${Object.entries(sprinklesProps)
              .map(([key, value]) => `${key}: ${value}`)
              .join(',\n    ')}
          })`;

                                const remainingObj = `{
            ${Object.entries(remainingProps)
              .map(([key, value]) => {
                const formattedKey = isSelector(key) ? `'${key}'` : key;
                return `${formattedKey}: ${value}`;
              })
              .join(',\n    ')}
          }`;

                                return fixer.replaceText(variantValue.value, `[\n  ${sprinklesObj},\n  ${remainingObj}\n]`);
                              },
                            });
                          }
                          return;
                        }
                      }

                      // 그 외의 경우 변환
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
                            const sprinklesEntries = Object.entries(sprinklesProps)
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(',\n    ');

                            const sprinklesObj = `sprinkles({
            ${sprinklesEntries}
          })`;

                            if (Object.keys(remainingProps).length === 0) {
                              return fixer.replaceText(variantValue.value, sprinklesObj);
                            }

                            const remainingEntries = Object.entries(remainingProps)
                              .map(([key, value]) => {
                                const formattedKey = isSelector(key) ? `'${key}'` : key;
                                return `${formattedKey}: ${value}`;
                              })
                              .join(',\n    ');

                            const remainingObj = `{
            ${remainingEntries}
          }`;

                            return fixer.replaceText(variantValue.value, `[\n  ${sprinklesObj},\n  ${remainingObj}\n]`);
                          },
                        });
                      }
                    }
                  });
                }
              });
            }
          }
        }
      },
    };
  },
};
