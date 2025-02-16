const isEmpty = (props) => Object.keys(props).length === 0;
const isObject = (node) => node?.type === 'ObjectExpression';
const isArray = (node) => node?.type === 'ArrayExpression';

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
  if (shorthands && shorthands.includes(propName)) {
    return true;
  }

  const configValue = sprinklesConfig[propName];
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
    // check value is included in configValue
    return configValue.includes(Number(cleanValue)) || configValue.includes(cleanValue);
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
    // check key is included in configValue keys
    return Object.keys(configValue).includes(cleanValue);
  }

  return false;
};

const separateProps = ({ sprinklesConfig, shorthands, properties, sourceCode }) => {
  const sprinklesMap = new Map();
  const remainingMap = new Map();

  for (const prop of properties) {
    const propName = prop.key.name || prop.key.value;
    const propValue = prop.value;
    const valueText = sourceCode.getText(propValue);

    // 이미 처리된 속성이면 스킵
    if (sprinklesMap.has(propName) || remainingMap.has(propName)) {
      continue;
    }

    if (isSelector(propName)) {
      remainingMap.set(propName, valueText);
      continue;
    }

    if (isVariable(propValue)) {
      remainingMap.set(propName, valueText);
      continue;
    }

    const cleanValue = valueText.replace(/['"]/g, '');

    const isDefinedValue = checkDefinedValueInSprinkles({
      sprinklesConfig,
      shorthands,
      propName,
      value: cleanValue,
    });

    if (isDefinedValue) {
      sprinklesMap.set(propName, valueText);
    } else {
      remainingMap.set(propName, valueText);
    }
  }

  const sprinklesProps = Object.fromEntries(sprinklesMap);
  const remainingProps = Object.fromEntries(remainingMap);

  return {
    sprinklesProps,
    remainingProps,
  };
};

const isRgbaOrComplexString = (value) => {
  return value.includes('rgba') || value.includes('rgb') || value.includes('var') || value.includes('${');
};

const cleanPropsString = (props) => {
  return Object.entries(props)
    .filter(([key, value]) => key.trim().length > 0 && value !== undefined) // 기존 필터 유지
    .map(([key, value]) => {
      if (isRgbaOrComplexString(value)) {
        return `${key}: ${value.replace(/\s+/g, ' ').trim()}`; // 공백 정리하고 trim
      }

      const cleanValue = typeof value === 'string' ? value.trim() : value;
      return `${key.trim()}: ${cleanValue}`;
    })
    .filter((prop) => prop.length > 0)
    .join(',\n    ');
};

const createTransformTemplate = ({ sourceCode, variables = [], sprinklesProps, remainingProps, isArrayContext = false }) => {
  const sprinklesString = cleanPropsString(sprinklesProps);
  const remainingString = cleanPropsString(remainingProps);

  if (variables.length > 0 || !isEmpty(remainingProps)) {
    const elements = [
      ...variables.map((v) => sourceCode.getText(v)),
      `sprinkles({\n    ${sprinklesString}\n  })`,
      ...(isEmpty(remainingProps) ? [] : [`{\n    ${remainingString}\n  }`]),
    ];

    return isArrayContext ? `[\n  ${elements.join(',\n  ')}\n]` : `style([\n  ${elements.join(',\n  ')}\n])`;
  }

  return `sprinkles({\n    ${sprinklesString}\n  })`;
};

const findSprinklesCallInArray = (arrayNode) => {
  return arrayNode.elements.find(
    (element) =>
      element?.type === 'CallExpression' && element.callee.name === 'sprinkles' && element.arguments?.[0]?.type === 'ObjectExpression',
  );
};

const checkSeparatedCorrectly = ({ sprinklesConfig, shorthands, sourceCode, sprinklesProps, remainingProps }) => {
  // sprinklesProps가 배열인 경우 (AST node 배열)
  const checkSprinklesProps = Array.isArray(sprinklesProps)
    ? sprinklesProps.every((prop) => {
        const propName = prop.key.name || prop.key.value;
        const value = sourceCode.getText(prop.value);
        return checkDefinedValueInSprinkles({
          sprinklesConfig,
          shorthands,
          propName,
          value,
        });
      })
    : // sprinklesProps가 객체인 경우
      Object.entries(sprinklesProps).every(([propName, value]) =>
        checkDefinedValueInSprinkles({
          sprinklesConfig,
          shorthands,
          propName,
          value,
        }),
      );

  // remainingProps가 배열인 경우 (AST node 배열)
  const checkRemainingProps = Array.isArray(remainingProps)
    ? remainingProps.every((prop) => {
        const propName = prop.key.name || prop.key.value;
        // selector나 variable인 경우는 remaining으로 간주
        if (isSelector(propName) || isVariable(prop.value)) {
          return true;
        }
        const value = sourceCode.getText(prop.value);
        return !checkDefinedValueInSprinkles({
          sprinklesConfig,
          shorthands,
          propName,
          value,
        });
      })
    : // remainingProps가 객체인 경우
      Object.entries(remainingProps).every(([propName, value]) => {
        if (isSelector(propName)) {
          return true;
        }
        return !checkDefinedValueInSprinkles({
          sprinklesConfig,
          shorthands,
          propName,
          value,
        });
      });

  return checkSprinklesProps && checkRemainingProps;
};
module.exports = {
  isEmpty,
  isObject,
  isArray,
  isVariable,
  isSelector,
  hasSelectors,
  separateProps,
  createTransformTemplate,
  findSprinklesCallInArray,
  checkSeparatedCorrectly,
};
