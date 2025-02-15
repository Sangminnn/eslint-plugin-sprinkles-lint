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

    if (!sprinklesConfig[propName]) {
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

  // Map을 객체로 변환
  return {
    sprinklesProps: Object.fromEntries(sprinklesMap),
    remainingProps: Object.fromEntries(remainingMap),
  };
};

const createTransformTemplate = ({ sourceCode, variables = [], sprinklesProps, remainingProps, isArrayContext = false }) => {
  const sprinklesString = Object.entries(sprinklesProps)
    .map(([key, value]) => `${key}: ${value}`)
    .join(',\n    ');

  const remainingString = Object.entries(remainingProps)
    .map(([key, value]) => `${key}: ${value}`)
    .join(',\n    ');

  if (variables.length > 0 || !isEmpty(remainingProps)) {
    const elements = [
      ...variables.map((v) => sourceCode.getText(v)),
      `sprinkles({\n    ${sprinklesString}\n  })`,
      ...(isEmpty(remainingProps) ? [] : [`{\n    ${remainingString}\n  }`]),
    ];

    return isArrayContext ? `[${elements.join(',\n  ')}]` : `style([${elements.join(',\n  ')}])`;
  }

  return `sprinkles({\n    ${sprinklesString}\n  })`;
};

const mergeSprinklesInArrayForm = ({ sourceCode, target, variables, sprinklesProps, remainingProps }) => {
  // get existing sprinkles properties
  const existingSprinklesProps = sourceCode.getText(target.arguments[0]);
  const existingProps = existingSprinklesProps
    .slice(1, -1) // remove first and last brace, {}
    .split(',')
    .map((prop) => prop.trim())
    .filter((prop) => prop.length > 0) // remove empty string
    .join(',\n    ');

  const sprinklesObj = `sprinkles({
    ${existingProps}${Object.keys(sprinklesProps).length ? ',' : ''}
    ${Object.entries(sprinklesProps)
      .map(([key, value]) => `${key}: ${value}`)
      .join(',\n    ')}
  })`;

  const remainingObj = `{
    ${Object.entries(remainingProps)
      .map(([key, value]) => {
        const formattedKey = isSelector(key) ? `'${key}'` : key;
        return `${formattedKey}: ${value}`;
      })
      .join(',\n    ')}
  }`;

  const elements = [
    ...variables.map((value) => sourceCode.getText(value)),
    sprinklesObj,
    ...(isEmpty(remainingProps) ? [] : [remainingObj]),
  ];

  return `[${elements.join(',\n  ')}]`;
};

const findSprinklesCallInArray = (arrayNode) => {
  return arrayNode.elements.find(
    (element) =>
      element?.type === 'CallExpression' && element.callee.name === 'sprinkles' && element.arguments?.[0]?.type === 'ObjectExpression',
  );
};

const checkSeparatedCorrectly = ({ sprinklesConfig, shorthands, sourceCode, sprinklesProps, remainingProps }) => {
  const isSprinklesPropsDefined = sprinklesProps?.every((prop) =>
    checkDefinedValueInSprinkles({
      sprinklesConfig,
      shorthands,
      propName: prop.key.name,
      value: sourceCode.getText(prop.value),
    }),
  );

  const isRemainingPropsNotDefined = remainingProps?.every(
    (prop) =>
      !checkDefinedValueInSprinkles({
        sprinklesConfig,
        shorthands,
        propName: prop.key.name,
        value: sourceCode.getText(prop.value),
      }),
  );

  return isSprinklesPropsDefined && isRemainingPropsNotDefined;
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
  mergeSprinklesInArrayForm,
  findSprinklesCallInArray,
  checkSeparatedCorrectly,
};
