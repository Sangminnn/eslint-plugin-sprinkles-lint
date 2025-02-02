const path = require("path");

// src/rules/no-use-style-declared-sprinkles.js
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

    // configPath가 있으면 파일에서 설정을 불러옴
    const sprinklesConfig = configPath
      ? require(path.resolve(process.cwd(), configPath))
      : options.sprinklesConfig;

    // 변수는 제외해야하기때문에 확인
    const isVariable = (node) => {
      return (
        node.type === "Identifier" ||
        node.type === "CallExpression" ||
        node.type === "MemberExpression"
      );
    };

    // 값이 허용된 것인지 확인하는 함수 추가
    const isAllowedValue = (propName, value) => {
      const configValue = sprinklesConfig[propName];

      // 배열인 경우
      if (Array.isArray(configValue)) {
        return configValue.includes(value);
      }

      // 객체인 경우 (예: flex)
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
            const sprinklesProps = {};
            const remainingProps = {};

            firstArg.properties.forEach((prop) => {
              const propName = prop.key.name;
              const propValue = prop.value;

              // 값이 변수인 경우 무시
              if (isVariable(propValue)) {
                remainingProps[propName] = sourceCode.getText(propValue);
                return;
              }

              // 문자열이나 숫자 값인 경우만 체크
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
          // 배열 전달 케이스 (style([{}]))
          else if (firstArg.type === "ArrayExpression") {
            firstArg.elements?.forEach((element) => {
              if (element.type === "ObjectExpression") {
                const sprinklesProps = {};
                const remainingProps = {};

                element.properties.forEach((prop) => {
                  const propName = prop.key.name;
                  const propValue = prop.value;

                  // 값이 변수인 경우 무시
                  if (isVariable(propValue)) {
                    remainingProps[propName] = sourceCode.getText(propValue);
                    return;
                  }

                  // 문자열이나 숫자 값인 경우만 체크
                  if (sprinklesConfig[propName]) {
                    const valueText = sourceCode.getText(propValue);
                    const cleanValue = valueText.replace(/['"]/g, "");
                    if (sprinklesConfig[propName].includes(cleanValue)) {
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
