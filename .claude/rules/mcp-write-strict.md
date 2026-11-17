# MCP Tools: Read-Normalize, Write-Strict

Policy for MCP tools (and CLI commands, which share the same core services).

## Read side: normalize

Tool output is shaped for an LLM: stable field names, timestamps with explicit offsets, ids always included so the next call can reference them. Omit Google's noise fields (etag, kind, htmlLink unless asked).

## Write side: strict

Reject invalid input instead of silently coercing it. The error message must let the caller self-correct in one step:

1. What was wrong (the offending value).
2. The full list of valid options or the expected format (e.g. `YYYY-MM-DD` or RFC 3339 with offset).
3. What to do next (which tool / argument to call).

Silent coercion (e.g. guessing a timezone, truncating a datetime to a date) loses information without telling the caller, and a later read-modify-write cycle bakes the loss in permanently.

## Destructive operations

Deleting events / tasks, or completing tasks in bulk, must be explicit in the tool name and arguments (no "update" that implicitly deletes).
