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

const isValidArrayForm = ({ node, sprinklesConfig }) => {
  if (isArrayExpression(node)) {
    const elements = node.elements;
    const firstElement = elements[0];
    const secondElement = elements[1];

    // 첫 번째 요소가 sprinkles 호출인지 확인
    const isSprinklesCall = firstElement?.type === 'CallExpression' && firstElement?.callee.name === 'sprinkles';

    // 두 번째 요소가 객체이고 sprinkles 속성을 포함하지 않는지 확인
    if (isSprinklesCall && isObjectExpression(secondElement)) {
      const regularProps = secondElement.properties.map((prop) => prop.key.name || prop.key.value);

      // 일반 객체의 속성들이 sprinkles에 정의되지 않았는지 확인
      const hasSprinklesProps = regularProps.some((prop) => sprinklesConfig[prop]);

      // sprinkles 속성이 있으면 유효하지 않은 형태
      return !hasSprinklesProps;
    }
  }
  return false;
};

module.exports = {
  isObjectExpression,
  isArrayExpression,
  isSelector,
  hasSelectors,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  isValidArrayForm,
};
