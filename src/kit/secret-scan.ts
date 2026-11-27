/**
 * The secret scan behind `plugin-kit forbidden`: the contract's detector (`secretFindings`), then a judgement of the
 * syntax around each credential assignment.
 *
 * The detector reads a value, and a value alone cannot tell `token: MintedToken` in a type annotation from
 * `token: MintedToken` in a YAML file. So the scan asks where the value sits, and sets aside only a finding whose
 * position proves it holds no literal:
 *
 * - **A declaration:** `const token = pageToken`. After `const`, `let`, `var`, `val` or `final`, an unquoted value is an
 *   expression, never a string literal. A quoted value stays a finding.
 * - **A parameter:** `login(password: string)`. An unquoted value after a colon inside the parentheses of a function
 *   signature is a type annotation. A signature is a name joined to its parenthesis and then followed by a return type,
 *   an arrow or a body, or a line that starts with `function`, `def`, `fn`, `func`, `fun` or `constructor`. A quoted
 *   value, an object literal inside the parentheses and prose in spaced parentheses stay findings.
 * - **A named format:** the token format written out in a markdown code span, such as `header.payload.signature`.
 *
 * In the first two cases the value must also be able to be an expression or a type: an identifier or member access, with
 * an optional prefix operator, generics, arrays or unions. A padded base64 value, a passphrase or a value with symbols is
 * never one, so it stays a finding in the same position.
 *
 * Every other finding stands: a key and value in a config file, an environment line, a quoted literal and every
 * known token shape. `test/fixtures/secret-corpus.txt` pins both sides.
 *
 * `secretKinds` itself is unchanged, because an app screens events with it and must refuse what the store refuses.
 */
import { secretFindings, type SecretFinding } from "../internal/secrets.ts"

/** `const`, `let`, `var`, `val` or `final`, with at most one type word, directly before the key. */
const DECLARATION = /\b(?:const|let|var|val|final)\s+(?:[\w$<>[\].?]+\s+)?$/

/** A line that opens a function declaration, after its modifiers. */
const FUNCTION_START = /^\s*(?:(?:export|default|public|private|protected|static|abstract|async|override|declare|pub)\s+)*(?:function\*?|def|fn|func|fun|constructor)\b/

/** What follows the closing parenthesis of a signature: a return type, an arrow or a body. */
const AFTER_SIGNATURE = /^\s*(?::|=>|->|\{)/

/** What an expression or a type can be: an identifier or member access, with a prefix operator, generics, arrays or unions. */
const EXPRESSION = /^(?:\+\+|--|!)?[A-Za-z_$][\w$.<>[\]|?]*$/

/** The operand that starts at a value: up to the first space, comma, semicolon or closing parenthesis. */
const OPERAND = /^[^\s,;)]*/

/** The parts of a token format, joined by dots: `header.payload.signature`. */
const FORMAT_PARTS = /^(?:header|payload|claims|body|signature|sig)(?:\.(?:header|payload|claims|body|signature|sig))+$/

/** The offset of the `(` that directly encloses `offset` in `line`, when no other bracket is open inside it. */
function enclosingParenthesis(line: string, offset: number): number | undefined {
  const open: number[] = []
  for (let index = 0; index < offset; index++) {
    const char = line[index]
    if (char === "(" || char === "[" || char === "{") open.push(index)
    else if (char === ")" || char === "]" || char === "}") open.pop()
  }
  const innermost = open.pop()
  return innermost !== undefined && line[innermost] === "(" ? innermost : undefined
}

/** Whether `line` is a function signature at its parenthesis `open`, which encloses the value at `valueOffset`. */
function signature(line: string, open: number, valueOffset: number): boolean {
  if (!/[\w$>]/.test(line[open - 1] ?? "")) return false
  if (FUNCTION_START.test(line.slice(0, open))) return true
  let depth = 0
  for (let index = valueOffset; index < line.length; index++) {
    const char = line[index]
    if (char === "(") depth++
    else if (char === ")") {
      if (depth === 0) return AFTER_SIGNATURE.test(line.slice(index + 1))
      depth--
    }
  }
  return false
}

/** Whether the position of an assignment's value shows that it holds no literal credential. */
function setAside(text: string, finding: SecretFinding): boolean {
  const site = finding.assignment
  if (site === undefined) return false
  if (site.quote === "`") return FORMAT_PARTS.test(site.value)
  if (site.quote !== undefined) return false
  const lineStart = text.lastIndexOf("\n", finding.index - 1) + 1
  const lineEnd = text.indexOf("\n", site.valueIndex)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  // The whole operand, not the part the detector read, must be an expression or a type, and no further word may follow it.
  const rest = line.slice(site.valueIndex - lineStart)
  const operand = OPERAND.exec(rest)![0]
  if (!EXPRESSION.test(operand) || /^\s+[\w$'"`]/.test(rest.slice(operand.length))) return false
  const keyOffset = finding.index - lineStart
  if (site.separator.includes("=")) return DECLARATION.test(line.slice(0, keyOffset))
  const open = enclosingParenthesis(line, keyOffset)
  return open !== undefined && signature(line, open, site.valueIndex - lineStart)
}

/** The kinds of credential in `text` that stand after the syntax around each assignment is judged. */
export function forbiddenSecretKinds(text: string): string[] {
  return [...new Set(secretFindings(text).filter((finding) => !setAside(text, finding)).map((finding) => finding.kind))]
}
