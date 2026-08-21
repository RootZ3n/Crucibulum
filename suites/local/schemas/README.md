# Output schemas for the constrained regime

One schema per fixture suite. They exist so that `json_schema` runs are
reproducible: a regime that names no schema is an unconstrained run wearing the
wrong label, and a schema that lives only in someone's shell history cannot be
re-run.

Each mirrors the keys its suite's prompt declares — nothing more. A schema that
demanded fields the prompt never mentioned would measure the model against a
contract it was never given, and a schema looser than the prompt would let the
constrained regime pass output the unconstrained regime is failed for.

`additionalProperties: false` throughout, because llama.cpp compiles these into
a grammar and an open object admits any key at all — which would make "valid
under the schema" a weaker claim than "valid under the prompt".

The digest of the exact file travels in the qualification identity as
`generation.outputSchemaDigest`, computed over a key-sorted canonical form, so
reformatting a file does not change what it identifies but editing it does.
