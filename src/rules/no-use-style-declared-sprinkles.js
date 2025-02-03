const path = require("path");

const {
  isSelector,
  hasSelectors,
  isObjectExpression,
  isArrayExpression,
  hasSprinklesCall,
  getExistingSprinklesCalls,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  getSprinklesPropsMap,
  getExistingElements,
} = require("./utils");

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Use Sprinkles for predefined style properties",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          sprinklesConfig: {
            type: "object",
            additionalProperties: {
              oneOf: [
                {
                  type: "array",
                  items: {
                    oneOf: [{ type: "string" }, { type: "number" }],
                  },
                },
                {
                  type: "object",
                  additionalProperties: {
                    type: "string",
                  },
                },
              ],
            },
          },
          configPath: {
            type: "string",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useSprinkles:
        "🚨 '{{ property }}' is defined in Sprinkles. Use sprinkles property instead.",
    },
    fixable: "code",
  },

  create(context) {
    const options = context.options[0] || {};

    // lint 선언 시 option으로 받아오는 sprinkles의 config
    const configPath = options.configPath;
    const sprinklesConfig = configPath
      ? require(path.resolve(process.cwd(), configPath))
      : options.sprinklesConfig;

    return {
      CallExpression(node) {
        if (node.callee.name === "style") {
          const sourceCode = context.getSourceCode();
          const firstArg = node.arguments[0];

          // style이 객체 형태로 선언될 떄 (ex. style({}))
          if (isObjectExpression(firstArg)) {
            // selector가 있는 경우
            if (hasSelectors(firstArg.properties)) {
              const { sprinklesProps, remainingProps } =
                getPropsInObjectCaseWithSelector({
                  config: sprinklesConfig,
                  properties: firstArg.properties,
                  sourceCode,
                });

              const hasSprinklesProps = Object.keys(sprinklesProps).length > 0;
              const hasRemainingProps = Object.keys(remainingProps).length > 0;

              if (!hasSprinklesProps) return;

              context.report({
                node: firstArg,
                messageId: "useSprinkles",
                data: {
                  property: Object.keys(sprinklesProps).join(", "),
                },
                fix(target) {
                  const sprinklesObj = `sprinkles({
                    ${Object.entries(sprinklesProps)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(",\n    ")}
                  })`;

                  // remainingProps가 없으면 sprinkles만 반환
                  if (!hasRemainingProps) {
                    return target.replaceText(node, sprinklesObj);
                  }

                  const remainingObj = `{
                      ${Object.entries(remainingProps)
                        .map(
                          ([key, value]) =>
                            `${isSelector(key) ? `'${key}'` : key}: ${value}`
                        )
                        .join(",\n    ")}
                    }`;

                  const convertedValue = `[${[sprinklesObj, remainingObj]
                    .filter(Boolean)
                    .join(",\n  ")}]`;

                  return target.replaceText(firstArg, convertedValue);
                },
              });
              return;
            }

            // selector가 없는 경우
            const { sprinklesProps, remainingProps } =
              getPropsInObjectCaseWithoutSelector({
                config: sprinklesConfig,
                properties: firstArg.properties,
                sourceCode,
              });

            const hasSprinklesProps = Object.keys(sprinklesProps).length > 0;
            const hasRemainingProps = Object.keys(remainingProps).length > 0;

            if (hasSprinklesProps) {
              context.report({
                node: firstArg,
                messageId: "useSprinkles",
                data: {
                  property: Object.keys(sprinklesProps).join(", "),
                },
                fix(fixer) {
                  const sprinklesObj = `sprinkles({
                    ${Object.entries(sprinklesProps)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(",\n    ")}
                  })`;

                  if (!hasRemainingProps) {
                    return fixer.replaceText(node, sprinklesObj);
                  }

                  const remainingObj = Object.keys(remainingProps).length
                    ? `{
                      ${Object.entries(remainingProps)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(",\n    ")}
                    }`
                    : "";

                  const convertedValue = `[${[sprinklesObj, remainingObj]
                    .filter(Boolean)
                    .join(",\n  ")}]`;

                  return fixer.replaceText(firstArg, convertedValue);
                },
              });
            }
          }

          // style이 배열 형태로 선언될 떄 (ex. style([flexCenter, sprinkles({}), { ...style }]))
          if (isArrayExpression(firstArg)) {
            firstArg.elements?.forEach((element) => {
              if (isObjectExpression(element)) {
                if (hasSelectors(element.properties)) {
                  return;
                }

                const existingSprinklesCalls = getExistingSprinklesCalls(
                  firstArg.elements
                );

                const { sprinklesProps, remainingProps } = getPropsInArrayCase({
                  element,
                  sourceCode,
                  config: sprinklesConfig,
                });

                if (Object.keys(sprinklesProps).length > 0) {
                  context.report({
                    node: element,
                    messageId: "useSprinkles",
                    data: {
                      property: Object.keys(sprinklesProps).join(", "),
                    },
                    fix(fixer) {
                      if (hasSprinklesCall(firstArg.elements)) {
                        const sprinklesPropsMap = getSprinklesPropsMap(
                          existingSprinklesCalls,
                          sourceCode
                        );
                        const remainingPropsMap = new Map(
                          Object.entries(remainingProps)
                        );

                        // 새로운 속성들을 sprinkles로 추가
                        Object.entries(sprinklesProps).forEach(
                          ([key, value]) => {
                            sprinklesPropsMap.set(key, value);
                          }
                        );

                        // 기존 요소들 (flexCenter 등)
                        const existingElements = getExistingElements(
                          firstArg.elements,
                          element,
                          sourceCode
                        );

                        // 남은 스타일 객체
                        const remainingObj =
                          remainingPropsMap.size > 0
                            ? `{
                            ${Array.from(remainingPropsMap.entries())
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(",\n    ")}
                          }`
                            : "";

                        // 다른 요소들이 없고 remainingProps도 없다면 sprinkles만 반환
                        if (existingElements.length === 0 && !remainingObj) {
                          return fixer.replaceText(
                            node,
                            `sprinkles({
                            ${Array.from(sprinklesPropsMap.entries())
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(",\n    ")}
                          })`
                          );
                        }

                        // 그 외의 경우는 배열로 처리
                        const newElements = [
                          ...existingElements,
                          `sprinkles({
                            ${Array.from(sprinklesPropsMap.entries())
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(",\n    ")}
                          })`,
                          ...(remainingObj ? [remainingObj] : []),
                        ];

                        return fixer.replaceText(
                          firstArg,
                          `[${newElements.join(",\n  ")}]`
                        );
                      } else {
                        const sprinklesObj = `sprinkles({
                          ${Object.entries(sprinklesProps)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(",\n    ")}
                        })`;

                        // remainingProps가 없으면 sprinkles만 반환
                        if (Object.keys(remainingProps).length === 0) {
                          return fixer.replaceText(node, sprinklesObj);
                        }

                        const remainingObj = Object.keys(remainingProps).length
                          ? `{
                          ${Object.entries(remainingProps)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(",\n    ")}
                        }`
                          : "";

                        const newCode = [sprinklesObj, remainingObj]
                          .filter(Boolean)
                          .join(",\n  ");

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
