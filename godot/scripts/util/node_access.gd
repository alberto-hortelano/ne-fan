## Node lookup helpers for the fail-loud contract.
##
## `must_get_node` looks up a child by path and `push_error`s + returns null
## when it's missing. Use it when the lookup is a hard precondition for the
## following code — i.e. when a null would make the rest of the method run
## with degraded behavior or crash later. For genuinely optional lookups,
## stay with `get_node_or_null` and document why the missing case is safe.
##
## Companion to `scripts/util/signal_lifecycle.gd`; together they cover the
## §1.5 (listener leaks) and §2.4 (silent null returns) of next.md.
class_name NodeAccess
extends RefCounted


static func must_get_node(root: Node, path: NodePath, context: String = "") -> Node:
	if root == null:
		push_error("NodeAccess.must_get_node: root is null (context=%s, path=%s)" % [context, path])
		return null
	var node: Node = root.get_node_or_null(path)
	if node == null:
		push_error("NodeAccess.must_get_node: '%s' not found under %s (context=%s)" % [
			path, root.get_path(), context,
		])
	return node
