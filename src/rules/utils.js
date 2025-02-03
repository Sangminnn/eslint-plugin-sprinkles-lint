const isVariable = (node) => {
  return (
    node.type === "Identifier" ||
    node.type === "CallExpression" ||
    node.type === "MemberExpression"
  );
};

// ex. :hover, &:hover
const isSelector = (propName) => {
  return propName.startsWith(":") || propName.startsWith("&");
};

const hasSelectors = (properties) => {
  return properties.some((prop) => isSelector(prop.key.name || prop.key.value));
};

const isObjectExpression = (node) => {
  return node.type === "ObjectExpression";
};

const isArrayExpression = (node) => {
  return node.type === "ArrayExpression";
};

const hasSprinklesCall = (elements) => {
  return elements.some(
    (element) =>
      element.type === "CallExpression" && element.callee.name === "sprinkles"
  );
};

const getExistingSprinklesCalls = (elements) => {
  return elements.filter(
    (el) => el.type === "CallExpression" && el.callee.name === "sprinkles"
  );
};

const isDefinedValueInSprinkles = ({ config, propName, value }) => {
  const configValue = config[propName];

  if (Array.isArray(configValue)) {
    return configValue.includes(Number(value)) || configValue.includes(value);
  }

  if (typeof configValue === "object" && configValue !== null) {
    return Object.values(configValue).includes(value);
  }

  return false;
};

const getPropsInObjectCaseWithSelector = ({
  config,
  properties,
  sourceCode,
}) => {
  const remainingProps = {};
  const sprinklesProps = {};

  properties.forEach((prop) => {
    const propName = prop.key.name || prop.key.value;
    remainingProps[propName] = sourceCode.getText(prop.value);
  });

  Object.entries(remainingProps).forEach(([key, value]) => {
    if (!isSelector(key) && !isVariable(value) && config[key]) {
      const cleanValue = value.replace(/['"]/g, "");

      if (
        isDefinedValueInSprinkles({
          config,
          propName: key,
          value: cleanValue,
        })
      ) {
        sprinklesProps[key] = value;
        delete remainingProps[key];
      }
    }
  });

  return { sprinklesProps, remainingProps };
};

const getPropsInObjectCaseWithoutSelector = ({
  config,
  properties,
  sourceCode,
}) => {
  const sprinklesProps = {};
  const remainingProps = {};

  properties.forEach((prop) => {
    const propName = prop.key.name || prop.key.value;
    const propValue = prop.value;

    if (isVariable(propValue)) {
      remainingProps[propName] = sourceCode.getText(propValue);
      return;
    }

    if (config[propName]) {
      const valueText = sourceCode.getText(propValue);
      const cleanValue = valueText.replace(/['"]/g, "");

      if (
        isDefinedValueInSprinkles({
          config,
          propName,
          value: cleanValue,
        })
      ) {
        sprinklesProps[propName] = valueText;
      } else {
        remainingProps[propName] = valueText;
      }
    }

    remainingProps[propName] = sourceCode.getText(propValue);
  });

  return { sprinklesProps, remainingProps };
};

const getPropsInArrayCase = ({ element, sourceCode, config }) => {
  const sprinklesProps = {};
  const remainingProps = {};

  element.properties.forEach((prop) => {
    const propName = prop.key.name || prop.key.value;
    const propValue = prop.value;

    if (isVariable(propValue)) {
      remainingProps[propName] = sourceCode.getText(propValue);
      return;
    }

    if (config[propName]) {
      const valueText = sourceCode.getText(propValue);
      const cleanValue = valueText.replace(/['"]/g, "");

      if (
        isDefinedValueInSprinkles({
          config,
          propName,
          value: cleanValue,
        })
      ) {
        sprinklesProps[propName] = valueText;
      } else {
        remainingProps[propName] = valueText;
      }
    } else {
      remainingProps[propName] = sourceCode.getText(propValue);
    }
  });

  return { sprinklesProps, remainingProps };
};

const getSprinklesPropsMap = (existingSprinklesCalls, sourceCode) => {
  const sprinklesPropsMap = new Map();

  existingSprinklesCalls.forEach((call) => {
    const props = sourceCode.getText(call.arguments[0]);
    const propsText = props.slice(1, -1).trim();
    const propPairs = propsText.split(",").map((pair) => pair.trim());
    propPairs.forEach((pair) => {
      if (pair) {
        const [key, value] = pair.split(":").map((part) => part.trim());
        sprinklesPropsMap.set(key, value);
      }
    });
  });

  return sprinklesPropsMap;
};

const getExistingElements = (elements, element, sourceCode) => {
  return elements
    .filter(
      (el) =>
        !(el.type === "CallExpression" && el.callee.name === "sprinkles") &&
        el !== element
    )
    .map((el) => sourceCode.getText(el));
};

module.exports = {
  isVariable,
  isSelector,
  hasSelectors,
  isObjectExpression,
  isArrayExpression,
  hasSprinklesCall,
  getExistingSprinklesCalls,
  isDefinedValueInSprinkles,
  getPropsInObjectCaseWithSelector,
  getPropsInObjectCaseWithoutSelector,
  getPropsInArrayCase,
  getSprinklesPropsMap,
  getExistingElements,
};
