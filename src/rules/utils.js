const isObjectExpression = (node) => node?.type === 'ObjectExpression';
const isArrayExpression = (node) => node?.type === 'ArrayExpression';

const isVariable = (node) => {
  return node.type === 'Identifier' || node.type === 'CallExpression' || node.type === 'MemberExpression';
};

const isSelector = (propName) => {
  return propName.startsWith(':') || propName.startsWith('&');
};

const hasSelectors = (properties) => {
  return properties.some((prop) => isSelector(prop.key.name || prop.key.value));
};

const checkDefinedValueInSprinkles = ({ sprinklesConfig, propName, value }) => {
  const configValue = sprinklesConfig[propName];

  if (Array.isArray(configValue)) {
    return configValue.includes(Number(value)) || configValue.includes(value);
  }

  if (typeof configValue === 'object' && configValue !== null) {
    return Object.values(configValue).includes(value);
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

    const cleanValue = value.replace(/['"]/g, '');
    const isDefinedValue = checkDefinedValueInSprinkles({
      sprinklesConfig,
      propName: key,
      value: cleanValue,
    });

    if (!isDefinedValue) {
      return;
    }

    sprinklesProps[key] = value;
    delete remainingProps[key];
  }

  return { sprinklesProps, remainingProps };
};

const getPropsInObjectCaseWithoutSelector = ({ sprinklesConfig, properties, sourceCode }) => {
  const sprinklesProps = {};
  const remainingProps = {};

  for (const prop of properties) {
    const propName = prop.key.name || prop.key.value;
    const propValue = prop.value;

    if (isVariable(propValue)) {
      remainingProps[propName] = sourceCode.getText(propValue);
      continue;
    }

    if (!sprinklesConfig[propName]) {
      remainingProps[propName] = sourceCode.getText(propValue);
      continue;
    }

    const valueText = sourceCode.getText(propValue);
    const cleanValue = valueText.replace(/['"]/g, '');

    const isDefinedValue = checkDefinedValueInSprinkles({
      sprinklesConfig,
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

const getPropsInArrayCase = ({ sprinklesConfig, element, sourceCode }) => {
  const sprinklesProps = {};
  const remainingProps = {};

  for (const prop of element.properties) {
    const propName = prop.key.name || prop.key.value;
    const propValue = prop.value;

    if (isVariable(propValue)) {
      remainingProps[propName] = sourceCode.getText(propValue);
      continue;
    }

    if (!sprinklesConfig[propName]) {
      remainingProps[propName] = sourceCode.getText(propValue);
      continue;
    }

    const valueText = sourceCode.getText(propValue);
    const cleanValue = valueText.replace(/['"]/g, '');

    const isDefinedValue = checkDefinedValueInSprinkles({
      sprinklesConfig,
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

const mergeSprinklesInArrayForm = ({ sourceCode, firstElement, sprinklesProps, remainingProps }) => {
  // get existing sprinkles properties
  const existingSprinklesProps = sourceCode.getText(firstElement.arguments[0]);
  const existingProps = existingSprinklesProps
    .slice(1, -1) // remove first and last brace, {}
    .split(',')
    .map((prop) => prop.trim())
    .filter((prop) => prop.length > 0) // remove empty string
    .join(',\n    ');

  // create new sprinkles object
  const sprinklesObj = `sprinkles({
    ${existingProps}${Object.keys(sprinklesProps).length ? ',' : ''}
    ${Object.entries(sprinklesProps)
      .map(([key, value]) => `${key}: ${value}`)
      .join(',\n    ')}
  })`;

  // create remaining object
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

  // 새로운 속성들을 sprinkles와 remaining으로 분류
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

module.exports = {
  isObjectExpression,
  isArrayExpression,
  isSelector,
  hasSelectors,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  createSprinklesTransform,
  mergeSprinklesInArrayForm,
  mergeSprinklesWithExistingElements,
};
