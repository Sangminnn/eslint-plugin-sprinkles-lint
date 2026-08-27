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
    
    // Check for numeric equivalence
    if (!isIncluded && !isNaN(Number(cleanValue))) {
      isIncluded = configValue.includes(Number(cleanValue));
    }
    
    // Check for string equivalence (case-insensitive)
    if (!isIncluded && typeof cleanValue === 'string') {
      isIncluded = configValue.some((item) => typeof item === 'string' && item.toLowerCase() === cleanValue.toLowerCase());
    }
    
    // Check for px unit bi-directional equivalence (px only special case)
    // 1. '40px' → check if 40 (number) exists
    // 2. 40 (number) → check if '40px' (string) exists
    if (!isIncluded) {
      // Case 1: value is '40px' string
      if (typeof cleanValue === 'string') {
        const pxMatch = cleanValue.match(/^([+-]?\d*\.?\d+)px$/);
        if (pxMatch) {
          const numValue = parseFloat(pxMatch[1]);
          if (!isNaN(numValue)) {
            isIncluded = configValue.includes(numValue);
          }
        }
      }

      // Case 2: value is number (e.g., 40), check for 'Npx' in config
      if (!isIncluded && typeof cleanValue === 'number') {
        const pxString = `${cleanValue}px`;
        isIncluded = configValue.some(item => item === pxString);
      }
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
   *
   * or
   *
   * "flex": {
   *  "1": "1 1 0%"
   * }
   */
  if (typeof configValue === 'object' && configValue !== null) {
    const keys = Object.keys(configValue);

    // Check direct key match
    const keyIncluded = keys.includes(cleanValue);
    if (keyIncluded) {
      return true;
    }

    // Check string-converted key match (for numeric values like flex: 1 matching flex: { '1': ... })
    const stringValue = String(cleanValue);
    const stringKeyIncluded = keys.includes(stringValue);
    if (stringKeyIncluded) {
      return true;
    }

    // Check value match
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

      // For object config (e.g., flex: { '1': '1 1 0%' }, borderColor: { 'gray-100': '#E5E5E5' })
      if (isConfigForPropObject) {
        const keys = Object.keys(configForProp);

        // Check if cleanValue (or its string form) matches any key
        let matchedKey = null;

        if (keys.includes(cleanValue)) {
          matchedKey = cleanValue;
        } else {
          // Check string-converted match (e.g., numeric 1 matches string key '1')
          const stringValue = String(cleanValue);
          if (keys.includes(stringValue)) {
            matchedKey = stringValue;
          }
        }

        if (matchedKey) {
          // Always use the matched key as a string literal
          sprinklesMap.set(propName, `'${matchedKey}'`);
          continue;
        }

        // Check if cleanValue matches a value in the object (reverse lookup)
        const keyMatchingToValue = findKeyByValue(configForProp, cleanValue);
        if (keyMatchingToValue) {
          sprinklesMap.set(propName, `'${keyMatchingToValue}'`);
          continue;
        }
      } else {
        // Array config - handle px bi-directional conversion
        if (Array.isArray(configForProp)) {
          let finalValue = valueText;

          // Case 1: value is '40px' string, check if 40 (number) exists in config
          const pxMatch = cleanValue.match(/^([+-]?\d*\.?\d+)px$/);
          if (pxMatch) {
            const numValue = parseFloat(pxMatch[1]);
            if (!isNaN(numValue) && configForProp.includes(numValue)) {
              // Config has number, convert to number
              finalValue = String(numValue);
            }
          }

          // Case 2: value is number (e.g., 40), check if '40px' exists in config
          if (propValue.type === 'Literal' && typeof propValue.value === 'number') {
            const pxString = `${propValue.value}px`;
            if (configForProp.includes(pxString)) {
              // Config has 'Npx' string, convert to 'Npx'
              finalValue = `'${pxString}'`;
            }
          }

          sprinklesMap.set(propName, finalValue);
        } else {
          // Direct match (not array, not object)
          sprinklesMap.set(propName, valueText);
        }
        continue;
      }
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
  // 빈 객체/배열 처리를 위한 스마트한 함수로 수정
  const isSprinklesEmpty = isEmpty(sprinklesProps);
  const isRemainingEmpty = isEmpty(remainingProps);
  const isVariablesEmpty = variables.length === 0;

  // 모든 것이 비어있는 경우
  if (isSprinklesEmpty && isRemainingEmpty && isVariablesEmpty) {
    return isArrayContext ? '[]' : '{}';
  }

  const sprinklesString = cleanPropsString(sprinklesProps);
  const remainingString = cleanPropsString(remainingProps);

  // 필터링된 요소 배열 구성
  const elements = [
    ...variables.map((v) => sourceCode.getText(v)),
    ...(isSprinklesEmpty ? [] : [`sprinkles({\n    ${sprinklesString}\n  })`]),
    ...(isRemainingEmpty ? [] : [`{\n    ${remainingString}\n  }`]),
  ];

  // 배열 컨텍스트인 경우 그대로 배열 반환
  if (isArrayContext) {
    return `[\n  ${elements.join(',\n  ')}\n]`;
  }

  // 변수나 남은 스타일이 있는 경우 style 배열로 감싸기
  if (!isVariablesEmpty || !isRemainingEmpty) {
    return `style([\n  ${elements.join(',\n  ')}\n])`;
  }

  // sprinklesProps만 있는 경우
  if (!isSprinklesEmpty) {
    return `sprinkles({\n    ${sprinklesString}\n  })`;
  }

  // 어떤 것도 없는 경우(이 경우는 위에서 이미 처리되었지만 안전장치로 포함)
  return '{}';
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
