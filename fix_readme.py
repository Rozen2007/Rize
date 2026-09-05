import re

def fix_ascii_boxes(content):
    lines = content.split('\n')
    
    # We will identify boxes by their top border `┌─...─┐`
    # and we will align the right `│` or `├` or `└` depending on the box
    
    inside_box = False
    box_width = 0
    
    for i, line in enumerate(lines):
        # Check if line is top border of a box
        if re.match(r'^┌─+┐$', line):
            inside_box = True
            # Compute width in characters (each character counts as 1)
            # However, some characters might be wider, but Python len() on unicode string works for basic length.
            # Let's use string length.
            box_width = len(line)
            continue
            
        if re.match(r'^└─+.*?─+┘$', line):
            inside_box = False
            continue
            
        if inside_box:
            # If line starts with │ and ends with │ (ignoring trailing spaces)
            m = re.match(r'^(│.*?)([│]+)\s*$', line)
            if m:
                left_part = m.group(1).rstrip()
                # pad with spaces to reach box_width - 1
                # then add '│'
                # width of left_part = len(left_part)
                padding = box_width - 1 - len(left_part)
                if padding > 0:
                    lines[i] = left_part + (' ' * padding) + '│'
                else:
                    lines[i] = left_part[:box_width - 2] + ' │'
            else:
                m2 = re.match(r'^(│.*?)\s*$', line)
                if m2:
                    left_part = m2.group(1).rstrip()
                    padding = box_width - 1 - len(left_part)
                    if padding > 0:
                        lines[i] = left_part + (' ' * padding) + '│'
    return '\n'.join(lines)

with open('README.md', 'r', encoding='utf-8') as f:
    content = f.read()

fixed = fix_ascii_boxes(content)

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(fixed)
print("Done")
