const path = require('path');
const {
  isObjectExpression,
  isArrayExpression,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  hasSelectors,
  isSelector,
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
      },
    };
  },
};
