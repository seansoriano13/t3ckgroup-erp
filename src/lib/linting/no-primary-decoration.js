/**
 * Pure predicate to determine if a class string violates the primary color usage rule.
 * 
 * @param {string} classString - The class string to check (e.g., from className prop)
 * @param {string} filePath - The absolute or relative path of the file being linted
 * @returns {boolean} True if the usage is a violation, false otherwise
 */
export function isViolation(classString, filePath) {
  if (!classString || typeof classString !== 'string') {
    return false;
  }

  // Allowlist: Components that are allowed to use primary colors
  const allowedComponents = [
    'button.jsx',
    'button.tsx',
    'ConfirmDialog.jsx',
    'ConfirmDialog.tsx',
  ];

  // If the file path matches any allowed component, it's not a violation
  const isAllowedPath = allowedComponents.some(allowed => 
    filePath.toLowerCase().endsWith(allowed.toLowerCase())
  );

  if (isAllowedPath) {
    return false;
  }

  const tokens = classString.split(/\s+/);
  
  for (const token of tokens) {
    // Primary utilities generally contain the word 'primary'
    // Exception: primary-foreground is a neutral color meant to be placed on top of a primary background
    if (token.includes('primary') && !token.includes('primary-foreground')) {
      return true;
    }
  }

  return false;
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow primary color utilities (red) outside of designated urgent components.',
      category: 'Styling',
      recommended: false,
      url: 'docs/adr/0009-primary-color-usage.md',
    },
    schema: [], // no options
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    function checkNode(node, classString) {
      if (isViolation(classString, filename)) {
        context.report({
          node,
          message: 'Primary color utilities (e.g., bg-primary, ring-primary) are reserved for primary actions and destructive dialogs. Use neutral colors instead. See docs/adr/0009-primary-color-usage.md',
        });
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name.name === 'className') {
          const valueNode = node.value;

          if (valueNode && valueNode.type === 'Literal') {
            checkNode(valueNode, valueNode.value);
          } else if (valueNode && valueNode.type === 'JSXExpressionContainer') {
            const expression = valueNode.expression;
            
            // Handle plain strings in expressions: className={"bg-primary"}
            if (expression.type === 'Literal' && typeof expression.value === 'string') {
              checkNode(expression, expression.value);
            }
            
            // Handle template literals: className={`bg-primary ${...}`}
            if (expression.type === 'TemplateLiteral') {
              for (const quasi of expression.quasis) {
                checkNode(quasi, quasi.value.raw);
              }
            }
          }
        }
      },
    };
  },
};
