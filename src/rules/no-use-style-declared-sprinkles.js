export default {
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
              // ✅ properties 밖으로 이동
              type: "array",
              items: { type: "string" },
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
    const sprinklesConfig = options.sprinklesConfig;

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
              const propValue = sourceCode.getText(prop.value);

              if (sprinklesConfig[propName]) {
                sprinklesProps[propName] = propValue;
              } else {
                remainingProps[propName] = propValue;
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

                  // style({}) -> style([sprinkles({}), {}])
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
                  const propValue = sourceCode.getText(prop.value);

                  if (sprinklesConfig[propName]) {
                    sprinklesProps[propName] = propValue;
                  } else {
                    remainingProps[propName] = propValue;
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
