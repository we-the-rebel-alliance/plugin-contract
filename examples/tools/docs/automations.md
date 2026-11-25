# Automations

Glyph declares no events source, so there is nothing to schedule. Its tools still run in Code Mode, over RPC, and from
an automation the person writes themselves.

A write is planned first:

```js
const plan = await tools.glyph.plan_write_note({ id: "welcome", text: "A new note." })
const note = await tools.glyph.write_note({ planId: plan.planId })
```
