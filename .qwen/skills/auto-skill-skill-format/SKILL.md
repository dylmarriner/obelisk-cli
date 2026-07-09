---
name: skill-format
description: Standard format for creating auto-generated skills — directory prefix, frontmatter, body structure
source: auto-skill
extracted_at: '2026-07-09T06:29:51.927Z'
triggers:
  - create-skill
  - generate-skill
  - skill-format
  - auto-skill
tags:
  - skill
  - format
  - auto-skill
  - generation
---

# Skill Format

Standard format for creating auto-generated skills in this project.

## Directory Structure

Every auto-generated skill MUST live at:

```
.qwen/skills/auto-skill-<name>/SKILL.md
```

The `auto-skill-` directory prefix is mandatory — the project's `.gitignore` uses this pattern to keep auto-generated skills out of version control.

## Frontmatter

Every SKILL.md MUST start with YAML frontmatter:

```yaml
---
name: <natural-name>           # The name WITHOUT the auto-skill- prefix
description: <one-line summary>
source: auto-skill              # Mandatory — marks it as auto-generated
extracted_at: '2026-07-09T06:29:51.927Z'
version: 1                      # Optional, increment on updates
triggers:                       # Optional — keywords that activate this skill
  - trigger-word
tags:                           # Optional — categorization tags
  - tag-name
---
```

Key rules:
- `name:` is the natural name (e.g. `skill-format`), NOT `auto-skill-format`
- `source: auto-skill` MUST be present — this tells the system it's safe to auto-update
- `extracted_at` is an ISO timestamp

## Body

The body is standard markdown. Recommended sections:

```markdown
# <Skill Name>

<Brief description of what this skill does and when to use it.>

## When to use

- <Trigger condition 1>
- <Trigger condition 2>

## Steps

1. <Step 1>
2. <Step 2>
3. <Step 3>

## References

- <Link or reference>
```

## Cross-Reference: SkillGenerator

The SkillGenerator in `packages/self-improve/src/skill-generator.ts` creates skills automatically. It uses:
- `SKILLS_DIR = ".qwen/skills"` as the base directory
- Directory name: `auto-skill-${name}`
- `name` in frontmatter: just `${name}` (no prefix)

If the SkillGenerator is not using the `auto-skill-` prefix, fix the `createSkill()` and `findSkill()` methods in that file.