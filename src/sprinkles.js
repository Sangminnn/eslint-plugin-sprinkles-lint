const sprinklesConfig = {
  position: ['absolute', 'relative', 'fixed', 'sticky'],
  display: ['none', 'flex', 'inline-flex', 'block', 'inline', 'grid'],
  flexDirection: ['row', 'column'],
  width: ['100%', 'auto', 'fit-content'],
  minHeight: ['100vh'],
  textAlign: ['left', 'center', 'right'],
  px: [16, 8, 12, 24],
  py: [13, 8, 12, 24],
  fontSize: [16, 14, 12, 18],
  fontWeight: [400, 500, 700],
  backgroundColor: ['white', 'black', 'transparent'],
  borderColor: {
    'gray-100': '#E5E5E5',
    'gray-900': '#2D2D2D',
    'red-500': '#FF0000',
  },
  borderRadius: [6, 8, 12, 1],
  boxSizing: ['border-box', 'content-box'],
  color: {
    'gray-0': 'var(--bdsg-scale-color-gray-0)',
    'gray-10': 'var(--bdsg-scale-color-gray-10)',
    'gray-800': '#333333',
    'gray-900': '#2D2D2D',
  },
  marginRight: [22, 0],
  lineHeight: ['normal', '1.5', '2'],
  cursor: ['pointer', 'default', 'not-allowed'],
  bottom: [0],
  left: [0],
};

const shorthands = ['px', 'py', 'mx', 'my'];

module.exports = { sprinklesConfig, shorthands };
