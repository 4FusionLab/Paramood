"""Quote-aware Fusion string syntax; never evaluate arbitrary Python input."""


def segments(source):
    start, i = 0, 0
    while i < len(source):
        if source[i] not in '\'"':
            i += 1
            continue
        if start < i:
            yield False, source[start:i]
        quote, start = source[i], i
        i += 1
        while i < len(source):
            if source[i] == '\\':
                i += 2
            elif source[i] == quote:
                i += 1
                yield True, source[start:i]
                start = i
                break
            else:
                i += 1
        else:
            raise ValueError('Unterminated string literal')
    if start < len(source):
        yield False, source[start:]


def decode_literal(source):
    quote, value, i = source[0], [], 1
    escapes = {'n': '\n', 'r': '\r', 't': '\t', '\\': '\\', "'": "'", '"': '"'}
    while i < len(source) - 1:
        char = source[i]
        if char == '\\':
            i += 1
            if i >= len(source) - 1:
                raise ValueError('Incomplete string escape')
            escaped = source[i]
            if escaped not in escapes:
                raise ValueError('Unsupported string escape: \\' + escaped)
            char = escapes[escaped]
        elif char == quote:
            raise ValueError('Unexpected quote in string literal')
        value.append(char)
        i += 1
    return ''.join(value)


def text_literal(value):
    return (
        "'"
        + value.replace('\\', '\\\\')
        .replace("'", "\\'")
        .replace('\n', '\\n')
        .replace('\r', '\\r')
        .replace('\t', '\\t')
        + "'"
    )


def map_code(source, transform):
    return ''.join(raw if literal else transform(raw) for literal, raw in segments(source))


def normalize_literals(source):
    return ''.join(
        text_literal(decode_literal(raw)) if literal else raw for literal, raw in segments(source)
    )


def split_definitions(source):
    result, current, depth = [], [], 0
    for literal, raw in segments(source):
        if literal:
            current.append(raw)
            continue
        for char in raw:
            if char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
            if char in ';\n' and depth == 0:
                if ''.join(current).strip():
                    result.append(''.join(current))
                current = []
            else:
                current.append(char)
    if depth != 0:
        raise ValueError('Unbalanced expression parentheses')
    if ''.join(current).strip():
        result.append(''.join(current))
    return result
