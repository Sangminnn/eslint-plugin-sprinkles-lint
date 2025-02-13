const path = require('path');
const {
  isEmpty,
  isObject,
  isArray,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  hasSelectors,
  createSprinklesTransform,
  mergeSprinklesInArrayForm,
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
            properties: {
              properties: {
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
              shorthands: {
                type: 'array',
                items: { type: 'string' },
              },
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

    const loadConfig = (configPath, options) => {
      if (configPath) {
        const config = require(path.resolve(process.cwd(), configPath));
        return {
          properties: config.properties,
          shorthands: config.shorthands,
        };
      }
      return {
        properties: options.sprinklesConfig?.properties || {},
        shorthands: options.sprinklesConfig?.shorthands || [],
      };
    };

    const configPath = options.configPath;
    const { properties: sprinklesConfig, shorthands } = loadConfig(configPath, options);

    return {
      CallExpression(node) {
        // using style
        if (node.callee.name === 'style') {
          const sourceCode = context.getSourceCode();

          // if style({}), {} is node.arguments[0]
          const styleArgument = node.arguments[0];

          // Case. style({})
          if (isObject(styleArgument)) {
            const getPropsFunction = hasSelectors(styleArgument.properties)
              ? getPropsInObjectCaseWithSelector
              : getPropsInObjectCaseWithoutSelector;

            const { sprinklesProps, remainingProps } = getPropsFunction({
              sprinklesConfig,
              shorthands,
              properties: styleArgument.properties,
              sourceCode,
            });

            if (isEmpty(sprinklesProps)) {
              return;
            }

            const targetProperties = Object.keys(sprinklesProps).join(', ');

            context.report({
              node: styleArgument,
              messageId: 'useSprinkles',
              data: {
                property: targetProperties,
              },
              fix(fixer) {
                if (isEmpty(remainingProps)) {
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

          // Case. style([])
          if (isArray(styleArgument)) {
            const sprinklesCall = findSprinklesCallInArray(styleArgument);
            const isEmptySprinkles = !sprinklesCall.arguments?.[0];

            // already use sprinkles but some properties are in style object not in sprinkles
            if (sprinklesCall) {
              if (isEmptySprinkles) return;

              if (hasEmptyObjectInArray(styleArgument)) {
                context.report({
                  node: styleArgument,
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

              const nonSprinklesObject = styleArgument.elements.find((element) => isObject(element));
              const allProperties = [...sprinklesCall.arguments[0].properties, ...(nonSprinklesObject?.properties || [])];

              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                sprinklesConfig,
                shorthands,
                properties: allProperties,
                sourceCode,
              });

              // if sprinkles and nonSprinkles are separated correctly, return instantly
              const isSeparatedCorrectly =
                sprinklesCall.arguments[0].properties.every((prop) => prop.key.name in sprinklesProps) &&
                nonSprinklesObject.properties.every((prop) => prop.key.name in remainingProps);

              if (isSeparatedCorrectly) {
                return;
              }

              if (isEmpty(sprinklesProps)) {
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

              if (isEmpty(remainingProps)) {
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

              const targetProperties = Object.keys(sprinklesProps).join(', ');

              context.report({
                node: styleArgument,
                messageId: 'useSprinkles',
                data: {
                  property: targetProperties,
                },
                fix(fixer) {
                  if (hasEmptyObjectInArray(styleArgument) && isEmpty(remainingProps)) {
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

            // not use sprinkles and use only style object, but some properties have to place in sprinkles
            styleArgument.elements?.forEach((element) => {
              if (!isObject(element) || hasSelectors(element.properties)) {
                return;
              }

              const { sprinklesProps, remainingProps } = getPropsInArrayCase({
                sprinklesConfig,
                shorthands,
                element,
                sourceCode,
              });

              if (isEmpty(sprinklesProps)) {
                return;
              }

              const targetProperties = Object.keys(sprinklesProps).join(', ');

              context.report({
                node: element,
                messageId: 'useSprinkles',
                data: {
                  property: targetProperties,
                },
                fix(fixer) {
                  return fixer.replaceText(
                    element,
                    createSprinklesTransform({
                      sprinklesProps,
                      remainingProps,
                    }),
                  );
                },
              });
            });
          }
        }

        // using recipe
        if (node.callee.name === 'recipe') {
          const sourceCode = context.getSourceCode();
          const recipeArgument = node.arguments[0];
          const baseProperty = recipeArgument.properties.find((prop) => prop.key.name === 'base');

          /** base in recipe */
          if (baseProperty && isArray(baseProperty.value)) {
            const sprinklesCall = findSprinklesCallInArray(baseProperty.value);
            if (!sprinklesCall) return;

            const isEmptySprinkles = !sprinklesCall.arguments?.[0];
            if (isEmptySprinkles) return;

            const styleObject = baseProperty.value.elements.find((element) => isObject(element));
            const isEmptyStyleObject = !styleObject || styleObject.properties.length === 0;

            if (isEmptyStyleObject) {
              context.report({
                node: baseProperty.value,
                messageId: 'useSprinkles',
                data: {
                  property: 'all',
                },
                fix(fixer) {
                  return fixer.replaceText(baseProperty.value, sourceCode.getText(sprinklesCall));
                },
              });
              return;
            }

            const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
              sprinklesConfig,
              shorthands,
              properties: styleObject.properties,
              sourceCode,
            });

            const targetProperties = Object.keys(sprinklesProps).join(', ');

            if (!isEmpty(sprinklesProps) || isEmptyStyleObject) {
              context.report({
                node: styleObject,
                messageId: 'useSprinkles',
                data: {
                  property: targetProperties,
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

          /** variants in recipe */
          const variantsProperty = recipeArgument.properties.find((prop) => prop.key.name === 'variants');

          if (variantsProperty && isObject(variantsProperty.value)) {
            // all object in variants check recursivly
            const checkVariantStyles = (node) => {
              if (!isObject(node)) return;

              const { sprinklesProps, remainingProps } = getPropsInObjectCaseWithoutSelector({
                sprinklesConfig,
                shorthands,
                properties: node.properties,
                sourceCode,
              });

              if (!isEmpty(sprinklesProps)) {
                context.report({
                  node,
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

            const findAndCheckStyles = (node) => {
              if (!node.properties) return;

              node.properties.forEach((prop) => {
                if (isObject(prop.value)) {
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
