const path = require("path");

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
    const configPath = options.configPath;
    const sprinklesConfig = configPath
      ? require(path.resolve(process.cwd(), configPath))
      : options.sprinklesConfig;

    const isVariable = (node) => {
      return (
        node.type === "Identifier" ||
        node.type === "CallExpression" ||
        node.type === "MemberExpression"
      );
    };

    const isSelector = (propName) => {
      return propName.startsWith(":") || propName.startsWith("&");
    };

    const hasSelectors = (properties) => {
      return properties.some((prop) =>
        isSelector(prop.key.name || prop.key.value)
      );
    };

    const isAllowedValue = (propName, value) => {
      const configValue = sprinklesConfig[propName];

      if (Array.isArray(configValue)) {
        // 숫자와 문자열 모두 체크
        return (
          configValue.includes(Number(value)) || configValue.includes(value)
        );
      }

      if (typeof configValue === "object" && configValue !== null) {
        return Object.values(configValue).includes(value);
      }

      return false;
    };

    return {
      CallExpression(node) {
        if (node.callee.name === "style") {
          const sourceCode = context.getSourceCode();
          const firstArg = node.arguments[0];

          // 객체 케이스
          if (firstArg.type === "ObjectExpression") {
            if (hasSelectors(firstArg.properties)) {
              const remainingProps = {};
              firstArg.properties.forEach((prop) => {
                const propName = prop.key.name || prop.key.value;
                remainingProps[propName] = sourceCode.getText(prop.value);
              });

              const sprinklesProps = {};
              Object.entries(remainingProps).forEach(([key, value]) => {
                if (
                  !isSelector(key) &&
                  sprinklesConfig[key] &&
                  !isVariable(value)
                ) {
                  const cleanValue = value.replace(/['"]/g, "");
                  if (isAllowedValue(key, cleanValue)) {
                    sprinklesProps[key] = value;
                    delete remainingProps[key];
                  }
                }
              });

              if (Object.keys(sprinklesProps).length > 0) {
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

                    const remainingObj = `{
                      ${Object.entries(remainingProps)
                        .map(
                          ([key, value]) =>
                            `${isSelector(key) ? `'${key}'` : key}: ${value}`
                        )
                        .join(",\n    ")}
                    }`;

                    const newCode = `[${[sprinklesObj, remainingObj]
                      .filter(Boolean)
                      .join(",\n  ")}]`;

                    return fixer.replaceText(firstArg, newCode);
                  },
                });
              }
            } else {
              const sprinklesProps = {};
              const remainingProps = {};

              firstArg.properties.forEach((prop) => {
                const propName = prop.key.name;
                const propValue = prop.value;

                if (isVariable(propValue)) {
                  remainingProps[propName] = sourceCode.getText(propValue);
                  return;
                }

                if (sprinklesConfig[propName]) {
                  const valueText = sourceCode.getText(propValue);
                  const cleanValue = valueText.replace(/['"]/g, "");
                  if (isAllowedValue(propName, cleanValue)) {
                    sprinklesProps[propName] = valueText;
                  } else {
                    remainingProps[propName] = valueText;
                  }
                } else {
                  remainingProps[propName] = sourceCode.getText(propValue);
                }
              });

              if (Object.keys(sprinklesProps).length > 0) {
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

                    const remainingObj = Object.keys(remainingProps).length
                      ? `{
                        ${Object.entries(remainingProps)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(",\n    ")}
                      }`
                      : "";

                    const newCode = `[${[sprinklesObj, remainingObj]
                      .filter(Boolean)
                      .join(",\n  ")}]`;

                    return fixer.replaceText(firstArg, newCode);
                  },
                });
              }
            }
            // 배열 케이스
          } else if (firstArg.type === "ArrayExpression") {
            firstArg.elements?.forEach((element) => {
              if (element.type === "ObjectExpression") {
                if (hasSelectors(element.properties)) {
                  return;
                }

                // 기존에 Array형태에서 sprinkles 호출이 있는 경우
                const existingSprinklesCalls = firstArg.elements.filter(
                  (el) =>
                    el.type === "CallExpression" &&
                    el.callee.name === "sprinkles"
                );

                const sprinklesProps = {};
                const remainingProps = {};

                element.properties.forEach((prop) => {
                  const propName = prop.key.name;
                  const propValue = prop.value;

                  if (isVariable(propValue)) {
                    remainingProps[propName] = sourceCode.getText(propValue);
                    return;
                  }

                  if (sprinklesConfig[propName]) {
                    const valueText = sourceCode.getText(propValue);
                    const cleanValue = valueText.replace(/['"]/g, "");
                    if (isAllowedValue(propName, cleanValue)) {
                      sprinklesProps[propName] = valueText;
                    } else {
                      remainingProps[propName] = valueText;
                    }
                  } else {
                    remainingProps[propName] = sourceCode.getText(propValue);
                  }
                });

                if (Object.keys(sprinklesProps).length > 0) {
                  context.report({
                    node: element,
                    messageId: "useSprinkles",
                    data: {
                      property: Object.keys(sprinklesProps).join(", "),
                    },
                    fix(fixer) {
                      if (existingSprinklesCalls.length > 0) {
                        
                        // 기존 sprinkles가 있는 경우
                        const existingSprinklesProps = existingSprinklesCalls
                          .map((call) => {
                            const props = sourceCode.getText(call.arguments[0]);
                            // 중괄호, 마지막 콤마 제거
                            return props
                              .slice(1, -1)
                              .trim()
                              .replace(/,\s*$/, "");
                          })
                          .filter(Boolean)
                          .join(",\n    ");

                        const mergedSprinklesObj = `sprinkles({
                          ${existingSprinklesProps}${
                            existingSprinklesProps ? "," : ""
                          }
                          ${Object.entries(sprinklesProps)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(",\n    ")}
                        })`;

                        // 1. 기존 요소들 (flexCenter 등)
                        const existingElements = firstArg.elements
                          .filter(
                            (el) =>
                              !(
                                el.type === "CallExpression" &&
                                el.callee.name === "sprinkles"
                              ) && // sprinkles가 아니고
                              el !== element // 현재 처리중인 요소도 아닌 것
                          )
                          .map((el) => sourceCode.getText(el));

                        // 2. 남은 스타일 객체
                        fix(fixer) {
                          if (existingSprinklesCalls.length > 0) {
                            // Map을 사용하여 중복 속성 관리
                            const sprinklesPropsMap = new Map();
                            const remainingPropsMap = new Map();
                        
                            // 기존 sprinkles 속성들 Map에 추가
                            existingSprinklesCalls.forEach((call) => {
                              const props = sourceCode.getText(call.arguments[0]);
                              const propsText = props.slice(1, -1).trim();
                              const propPairs = propsText.split(',').map(pair => pair.trim());
                              propPairs.forEach(pair => {
                                if (pair) {
                                  const [key, value] = pair.split(':').map(part => part.trim());
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
                              .filter(el => 
                                !(el.type === "CallExpression" && el.callee.name === "sprinkles") && 
                                el !== element
                              )
                              .map(el => sourceCode.getText(el));
                        
                            // 2. 남은 스타일 객체
                            const remainingObj = remainingPropsMap.size > 0
                              ? `{
                            ${Array.from(remainingPropsMap.entries())
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(",\n    ")}
                          }`
                              : "";
                        
                            // 순서대로 배열 구성
                            const newElements = [
                              ...existingElements,
                              mergedSprinklesObj,
                              ...(remainingObj ? [remainingObj] : [])
                            ];
                        
                            return fixer.replaceText(
                              firstArg,
                              `[${newElements.join(",\n  ")}]`
                            );
                          } else {
                        // 기존 sprinkles가 없는 경우 (기존 로직)
                        const sprinklesObj = `sprinkles({
                          ${Object.entries(sprinklesProps)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(",\n    ")}
                        })`;

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
