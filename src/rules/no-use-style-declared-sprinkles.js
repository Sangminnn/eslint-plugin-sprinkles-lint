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

    // 변수인지 확인
    const isVariable = (node) => {
      return (
        node.type === "Identifier" ||
        node.type === "CallExpression" ||
        node.type === "MemberExpression"
      );
    };

    // 셀렉터인지 확인
    const isSelector = (propName) => {
      return propName.startsWith(":") || propName.startsWith("&");
    };

    // 객체에 셀렉터가 포함되어 있는지 확인
    const hasSelectors = (properties) => {
      return properties.some((prop) =>
        isSelector(prop.key.name || prop.key.value)
      );
    };

    // 값이 허용된 것인지 확인
    const isAllowedValue = (propName, value) => {
      const configValue = sprinklesConfig[propName];

      if (Array.isArray(configValue)) {
        return configValue.includes(value);
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

          // 객체 직접 전달 케이스 (style({}))
          if (firstArg.type === "ObjectExpression") {
            // 셀렉터가 있는 경우
            if (hasSelectors(firstArg.properties)) {
              const remainingProps = {};
              firstArg.properties.forEach((prop) => {
                const propName = prop.key.name || prop.key.value;
                remainingProps[propName] = sourceCode.getText(prop.value);
              });

              // sprinkles로 변환 가능한 속성 확인
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
                        .join(",\n")}
                    })`;

                    const remainingObj = `{
                      ${Object.entries(remainingProps)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(",\n")}
                    }`;

                    const newCode = `[${[sprinklesObj, remainingObj]
                      .filter(Boolean)
                      .join(",\n")}]`;

                    return fixer.replaceText(firstArg, newCode);
                  },
                });
              }
            } else {
              // 셀렉터가 없는 일반적인 케이스
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
                        .join(",\n")}
                    })`;

                    const remainingObj = Object.keys(remainingProps).length
                      ? `{
                          ${Object.entries(remainingProps)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(",\n")}
                        }`
                      : "";

                    const newCode = `[${[sprinklesObj, remainingObj]
                      .filter(Boolean)
                      .join(",\n")}]`;

                    return fixer.replaceText(firstArg, newCode);
                  },
                });
              }
            }
          }
          // 배열 전달 케이스 (style([{}]))
          else if (firstArg.type === "ArrayExpression") {
            firstArg.elements?.forEach((element) => {
              if (element.type === "ObjectExpression") {
                if (hasSelectors(element.properties)) {
                  // 셀렉터가 있는 경우는 그대로 둠
                  return;
                }

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
                      const sprinklesObj = `sprinkles({
                        ${Object.entries(sprinklesProps)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(",\n")}
                      })`;

                      const remainingObj = Object.keys(remainingProps).length
                        ? `{
                            ${Object.entries(remainingProps)
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(",\n")}
                          }`
                        : "";

                      const newCode = [sprinklesObj, remainingObj]
                        .filter(Boolean)
                        .join(",\n");

                      return fixer.replaceText(element, newCode);
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
