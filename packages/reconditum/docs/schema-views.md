# SQLite VIEWs — Graph Inspection

The `SQLiteStore` creates three read-only VIEWs on initialization to simplify
graph inspection without building a graphical interface.

## `v_nodes`

Denormalized node listing with commonly-accessed metadata fields extracted via
`json_extract`.

| Column      | Source                                    |
| ----------- | ----------------------------------------- |
| `id`        | `nodes.id`                                |
| `type`      | `nodes.type`                              |
| `label`     | `nodes.label`                             |
| `createdAt` | `nodes.created_at`                        |
| `updatedAt` | `nodes.updated_at`                        |
| `title`     | `json_extract(metadata, '$.title')`       |
| `state`     | `json_extract(metadata, '$.state')`       |
| `videoId`   | `json_extract(metadata, '$.videoId')`     |
| `source`    | `json_extract(metadata, '$.source')`      |

**Example:**

```sql
SELECT * FROM v_nodes WHERE type = 'Claim' AND state = 'draft';
```

## `v_edges`

Flat edge listing with an optional extracted weight.

| Column      | Source                                    |
| ----------- | ----------------------------------------- |
| `subject`   | `edges.subject`                           |
| `predicate` | `edges.predicate`                         |
| `object`    | `edges.object`                            |
| `createdAt` | `edges.created_at`                        |
| `weight`    | `json_extract(metadata, '$.weight')`      |

**Example:**

```sql
SELECT * FROM v_edges WHERE predicate = 'aboutTag';
```

## `v_claims_with_sources`

Joins Claim nodes to their source via the `claimDerivedFrom` edge.

| Column        | Source                                          |
| ------------- | ----------------------------------------------- |
| `claimId`     | `nodes.id` (where type = 'Claim')               |
| `claimLabel`  | `nodes.label`                                   |
| `claimContent`| `nodes.content`                                 |
| `state`       | `json_extract(metadata, '$.state')`             |
| `videoId`     | `json_extract(metadata, '$.videoId')`           |
| `sourceId`    | `edges.object` (via `claimDerivedFrom`)         |
| `sourceLabel` | source `nodes.label`                            |
| `sourceType`  | source `nodes.type`                             |
| `createdAt`   | claim `nodes.created_at`                        |

**Example:**

```sql
SELECT claimId, claimLabel, state, sourceLabel
FROM v_claims_with_sources
WHERE videoId = 'abc123' AND state = 'accepted';
```
