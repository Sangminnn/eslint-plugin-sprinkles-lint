const isEmpty = (props) => Object.keys(props).length === 0;
const isObject = (node) => node?.type === 'ObjectExpression';
const isArray = (node) => node?.type === 'ArrayExpression';

const isStyleArray = (node) => node?.type === 'CallExpression' && node.callee.name === 'style' && isArray(node.arguments[0]);

const isVariable = (node) => {
  return node.type === 'Identifier' || node.type === 'CallExpression' || node.type === 'MemberExpression';
};

const isSelector = (propName) => {
  return propName.startsWith(':') || propName.startsWith('&');
};

const hasSelectors = (properties) => {
  return properties.some((prop) => isSelector(prop.key.name || prop.key.value));
};

const checkDefinedValueInSprinkles = ({ sprinklesConfig, shorthands, propName, value }) => {
  if (shorthands && Array.isArray(shorthands) && shorthands.includes(propName)) {
    return true;
  }

  const configValue = sprinklesConfig[propName];
  if (!configValue) {
    return false;
  }

  const cleanValue = typeof value === 'number' ? value : value.replace(/['"]/g, '').trim();

  /**
   * Array Case
   *
   * "width": [
   *  "auto",
   *  "100%",
   *  "fit-content",
   *  "100vw"
   * ]
   */
  if (Array.isArray(configValue)) {
    let isIncluded = configValue.includes(cleanValue);
    if (!isIncluded && !isNaN(Number(cleanValue))) {
      isIncluded = configValue.includes(Number(cleanValue));
    }

    if (!isIncluded && typeof cleanValue === 'string') {
      isIncluded = configValue.some((item) => typeof item === 'string' && item.toLowerCase() === cleanValue.toLowerCase());
    }

    return isIncluded;
  }

  /**
   * Object case
   *
   * "borderColor": {
   *  "white": "#ffffff",
   *  "gray": "#f6f6f6",
   *  "gray-10": "#fafafa",
   *  "gray-50": "#f6f6f6",
   *  "gray-100": "#e5e5e5",
   * }
   */
  if (typeof configValue === 'object' && configValue !== null) {
    const keys = Object.keys(configValue);
    const keyIncluded = keys.includes(cleanValue);
    if (keyIncluded) return true;

    const values = Object.values(configValue);
    const valuesAsString = values.map((v) => String(v).trim());
    const valueIncluded = valuesAsString.includes(String(cleanValue).trim());

    return valueIncluded;
  }

  return false;
};

const findKeyByValue = (obj, valueToFind) => {
  const cleanValueToFind = String(valueToFind).replace(/['"]/g, '').trim();

  for (const [key, value] of Object.entries(obj)) {
    const cleanValue = String(value).replace(/['"]/g, '').trim();
    if (cleanValue === cleanValueToFind) {
      return key;
    }
  }
  return null;
};

const separateProps = ({ sprinklesConfig, shorthands, properties, sourceCode }) => {
  try {
    const safeShorthands = shorthands && Array.isArray(shorthands) ? [...shorthands] : undefined;

    const sprinklesMap = new Map();
    const remainingStyleMap = new Map();

    for (const prop of properties) {
      const propName = prop.key.name || prop.key.value;
      const propValue = prop.value;
      const valueText = sourceCode.getText(propValue);

      // skip for already processed prop
      if (sprinklesMap.has(propName) || remainingStyleMap.has(propName)) {
        continue;
      }

      if (isSelector(propName)) {
        remainingStyleMap.set(propName, valueText);
        continue;
      }

      if (isVariable(propValue)) {
        remainingStyleMap.set(propName, valueText);
        continue;
      }

      const cleanValue = valueText.replace(/['"]/g, '');

      const isDefinedValue = checkDefinedValueInSprinkles({
        sprinklesConfig,
        shorthands: safeShorthands,
        propName,
        value: cleanValue,
      });

      if (!isDefinedValue) {
        remainingStyleMap.set(propName, valueText);
        continue;
      }

      const configForProp = sprinklesConfig[propName];
      const isConfigForPropObject = typeof configForProp === 'object' && !Array.isArray(configForProp);
      const isMatching = isConfigForPropObject ? Object.keys(configForProp).includes(cleanValue) : false;

      if (!isConfigForPropObject || isMatching) {
        sprinklesMap.set(propName, valueText);
        continue;
      }

      // find key by value
      const keyMatchingToValue = findKeyByValue(configForProp, cleanValue);
      if (keyMatchingToValue) {
        sprinklesMap.set(propName, `'${keyMatchingToValue}'`);
        continue;
      }

      sprinklesMap.set(propName, valueText);
    }

    const sprinklesProps = Object.fromEntries(sprinklesMap);
    const remainingProps = Object.fromEntries(remainingStyleMap);

    return {
      sprinklesProps,
      remainingProps,
    };
  } catch (error) {
    return {
      sprinklesProps: {},
      remainingProps: {},
    };
  }
};

const isRgbaOrComplexString = (value) => {
  return value.includes('rgba') || value.includes('rgb') || value.includes('var') || value.includes('${');
};

const cleanPropsString = (props) => {
  return Object.entries(props)
    .filter(([key, value]) => key.trim().length > 0 && value !== undefined)
    .map(([key, value]) => {
      const needsQuotes = key.includes(':') || key.includes('-') || key.includes(' ') || key.startsWith('@');
      const formattedKey = needsQuotes ? `'${key}'` : key;

      // rgba or complex string value
      if (typeof value === 'string' && isRgbaOrComplexString(value)) {
        return `${formattedKey}: ${value.replace(/\s+/g, ' ').trim()}`;
      }

      // value is object (ex. ::placeholder)
      if (typeof value === 'object' && value !== null) {
        return `${formattedKey}: ${JSON.stringify(value, null, 2)}`;
      }

      // normal value
      const cleanValue = typeof value === 'string' ? value.trim() : value;
      return `${formattedKey}: ${cleanValue}`;
    })
    .filter((prop) => prop.length > 0)
    .join(',\n    ');
};

const createTransformTemplate = ({ sourceCode, variables = [], sprinklesProps, remainingProps, isArrayContext = false }) => {
  const sprinklesString = cleanPropsString(sprinklesProps);
  const remainingString = cleanPropsString(remainingProps);

  const elements = [
    ...variables.map((v) => sourceCode.getText(v)),
    `sprinkles({\n    ${sprinklesString}\n  })`,
    ...(isEmpty(remainingProps) ? [] : [`{\n    ${remainingString}\n  }`]),
  ];

  if (isArrayContext) {
    return `[\n  ${elements.join(',\n  ')}\n]`;
  }

  if (variables.length > 0 || !isEmpty(remainingProps)) {
    return `style([\n  ${elements.join(',\n  ')}\n])`;
  }

  return `sprinkles({\n    ${sprinklesString}\n  })`;
};

const isSprinklesCall = (node) => {
  return node?.type === 'CallExpression' && node.callee.name === 'sprinkles';
};

const findSprinklesCallInArray = (arrayNode) => {
  return arrayNode.elements.find((element) => isSprinklesCall(element) && element.arguments?.[0]?.type === 'ObjectExpression');
};

const checkSeparatedCorrectly = ({ sprinklesConfig, shorthands, sourceCode, sprinklesProps, remainingProps }) => {
  try {
    const safeShorthands = shorthands && Array.isArray(shorthands) ? [...shorthands] : undefined;

    const checkSprinklesProps = Array.isArray(sprinklesProps)
      ? sprinklesProps.every((prop) => {
          const propName = prop.key.name || prop.key.value;
          const value = sourceCode.getText(prop.value);
          const isDefinedInSprinkles = checkDefinedValueInSprinkles({
            sprinklesConfig,
            shorthands: safeShorthands,
            propName,
            value,
          });
          return isDefinedInSprinkles;
        })
      : // when sprinklesProps is object
        Object.entries(sprinklesProps).every(([propName, value]) => {
          const isDefinedInSprinkles = checkDefinedValueInSprinkles({
            sprinklesConfig,
            shorthands: safeShorthands,
            propName,
            value,
          });
          return isDefinedInSprinkles;
        });

    const checkRemainingProps = Array.isArray(remainingProps)
      ? remainingProps.every((prop) => {
          const propName = prop.key.name || prop.key.value;
          // selector or variable is considered as remaining
          if (isSelector(propName) || isVariable(prop.value)) {
            return true;
          }
          const value = sourceCode.getText(prop.value);
          const isDefinedInSprinkles = checkDefinedValueInSprinkles({
            sprinklesConfig,
            shorthands: safeShorthands,
            propName,
            value,
          });
          return !isDefinedInSprinkles;
        })
      : // when remainingProps is object
        Object.entries(remainingProps).every(([propName, value]) => {
          if (isSelector(propName)) {
            return true;
          }
          const isDefinedInSprinkles = checkDefinedValueInSprinkles({
            sprinklesConfig,
            shorthands: safeShorthands,
            propName,
            value,
          });
          return !isDefinedInSprinkles;
        });

    return checkSprinklesProps && checkRemainingProps;
  } catch (error) {
    return false;
  }
};

const hasNestedSelectors = (properties) => {
  if (!properties) return false;

  return properties.some((prop) => {
    const propName = prop.key.name || prop.key.value;
    if (isSelector(propName)) {
      return true;
    }

    if (isObject(prop.value) && prop.value.properties) {
      return hasNestedSelectors(prop.value.properties);
    }

    return false;
  });
};

module.exports = {
  isEmpty,
  isObject,
  isArray,
  isStyleArray,
  isVariable,
  isSelector,
  hasSelectors,
  separateProps,
  createTransformTemplate,
  isSprinklesCall,
  findSprinklesCallInArray,
  checkSeparatedCorrectly,
  cleanPropsString,
  checkDefinedValueInSprinkles,
  hasNestedSelectors,
};
