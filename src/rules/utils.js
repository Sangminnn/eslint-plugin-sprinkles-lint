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
  const cleanValue = value.replace(/['"]/g, '');

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

const getPropsInObjectCaseWithSelector = ({ sprinklesConfig, properties, sourceCode }) => {
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

    const isDefinedValue = checkDefinedValueInSprinkles({
      sprinklesConfig,
      shorthands,
      propName,
      value: valueText,
    });

    if (isDefinedValue) {
      sprinklesProps[propName] = valueText;
    } else {
      remainingProps[propName] = valueText;
    }
  }

  return { sprinklesProps, remainingProps };
};

const getPropsInArrayCase = ({ sprinklesConfig, shorthands, element, sourceCode }) => {
  const sprinklesProps = {};
  const remainingProps = {};

  for (const prop of element.properties) {
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

const createSprinklesTransform = ({ sprinklesProps, remainingProps }) => {
  const sprinklesObj = `sprinkles({
    ${Object.entries(sprinklesProps)
      .map(([key, value]) => `${key}: ${value}`)
      .join(',\n    ')}
  })`;

  if (Object.keys(remainingProps).length === 0) {
    return sprinklesObj;
  }

  const remainingObj = `{
    ${Object.entries(remainingProps)
      .map(([key, value]) => {
        const formattedKey = isSelector(key) ? `'${key}'` : key;
        return `${formattedKey}: ${value}`;
      })
      .join(',\n    ')}
  }`;

  return `[\n  ${sprinklesObj},\n  ${remainingObj}\n]`;
};

const mergeSprinklesInArrayForm = ({ sourceCode, target, sprinklesProps, remainingProps }) => {
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

  return `[\n  ${sprinklesObj},\n  ${remainingObj}\n]`;
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

module.exports = {
  isEmpty,
  isObject,
  isArray,
  isSelector,
  hasSelectors,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  createSprinklesTransform,
  mergeSprinklesInArrayForm,
  mergeSprinklesWithExistingElements,
  hasEmptyObjectInArray,
  findSprinklesCallInArray,
};
