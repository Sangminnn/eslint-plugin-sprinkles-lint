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
  const cleanValue = value.replace(/['"]/g, '').trim();

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

const getPropsInObject = (properties) =>
  hasSelectors(properties) ? getPropsInObjectCaseWithSelector : getPropsInObjectCaseWithoutSelector;

const getPropsInObjectCaseWithSelector = ({ sprinklesConfig, shorthands, properties, sourceCode }) => {
  const sprinklesProps = {};

  const remainingProps = properties.reduce((acc, prop) => {
    const propName = prop.key.name || prop.key.value;
    acc[propName] = sourceCode.getText(prop.value);
    return acc;
  }, {});

  for (const [key, value] of Object.entries(remainingProps)) {
    if (isSelector(key)) continue;
    if (isVariable(value)) continue;
    if (!sprinklesConfig[key]) continue;

    const isDefinedValue = checkDefinedValueInSprinkles({
      sprinklesConfig,
      shorthands,
      propName: key,
      value,
    });

    if (isDefinedValue) {
      sprinklesProps[key] = value;
      delete remainingProps[key];
    }
  }

  return { sprinklesProps, remainingProps };
};

const getPropsInObjectCaseWithoutSelector = ({ sprinklesConfig, shorthands, properties, sourceCode }) => {
  const sprinklesProps = {};
  const remainingProps = {};

  for (const prop of properties) {
    const propName = prop.key.name || prop.key.value;
    const propValue = prop.value;
    const valueText = sourceCode.getText(propValue);

    if (isVariable(propValue)) {
      remainingProps[propName] = valueText;
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
      sprinklesProps[propName] = valueText;
    } else {
      remainingProps[propName] = valueText;
    }
  }

  return { sprinklesProps, remainingProps };
};

const createSprinklesTransform = ({ sourceCode, variables = [], sprinklesProps, remainingProps, isArrayContext = false }) => {
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
    // 배열 컨텍스트일 때는 배열만 반환
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

const mergeSprinklesWithExistingElements = ({ sourceCode, existingSprinklesCalls, sprinklesProps, remainingProps, existingElements }) => {
  // Map을 사용하여 중복 속성 관리
  const sprinklesPropsMap = new Map();
  const remainingPropsMap = new Map();

  // 기존 sprinkles 속성들 Map에 추가
  existingSprinklesCalls.forEach((call) => {
    if (!call.arguments?.[0]) return;

    const props = sourceCode.getText(call.arguments[0]);
    const propsText = props.slice(1, -1).trim();
    const propPairs = propsText.split(',').map((pair) => pair.trim());

    propPairs.forEach((pair) => {
      if (pair) {
        const [key, value] = pair.split(':').map((part) => part.trim());
        sprinklesPropsMap.set(key, value);
      }
    });
  });

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

  const remainingObj =
    remainingPropsMap.size > 0
      ? `{
        ${Array.from(remainingPropsMap.entries())
          .map(([key, value]) => `${key}: ${value}`)
          .join(',\n    ')}
      }`
      : '';

  if (existingElements.length === 0 && !remainingObj) {
    return mergedSprinklesObj;
  }

  const newElements = [...existingElements, mergedSprinklesObj, ...(remainingObj ? [remainingObj] : [])];
  return `[${newElements.join(',\n  ')}]`;
};

const hasEmptyObjectInArray = (arrayNode) => {
  return arrayNode.elements.some((element) => isObject(element) && element.properties.length === 0);
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
  checkDefinedValueInSprinkles,
  getPropsInObject,
  createSprinklesTransform,
  mergeSprinklesInArrayForm,
  mergeSprinklesWithExistingElements,
  hasEmptyObjectInArray,
  findSprinklesCallInArray,
  checkSeparatedCorrectly,
};
