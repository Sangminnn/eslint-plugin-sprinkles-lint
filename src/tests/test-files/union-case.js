const style = (obj) => obj;
const sprinkles = (obj) => obj;

const testStyle = style([
  sprinkles({
    position: "absolute",
  }),
  {
    display: "flex",
    flexDirection: "row",
  },
]);
