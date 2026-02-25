# Example Rule Configurations

Three example agent configurations demonstrating the full range of the Autarch rule engine. Each builds on the previous, progressing from basics to advanced features.

| Config | Level | Demonstrates |
|---|---|---|
| `conservative.json` | Beginner | Single-threshold rules, basic buy/sell |
| `dip-buyer.json` | Intermediate | Compound AND/OR conditions, weighted scoring |
| `momentum.json` | Advanced | Inter-agent peer dependencies, NOT logic |

## JSON Config Structure

### Root Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Agent display name (min 1 char) |
| `strategy` | string | Yes | Strategy label shown in dashboard (min 1 char) |
| `intervalMs` | number | No | Evaluation interval in ms (min 1000, default 60000) |
| `rules` | array | Yes | Array of rule objects (min 1 rule) |

### Rule Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Rule display name (min 1 char) |
| `conditions` | array | Yes | Array of condition objects (min 1 condition) |
| `action` | enum | Yes | `"buy"`, `"sell"`, `"transfer"`, or `"none"` |
| `amount` | number | Yes | Trade amount in SOL (must be > 0) |
| `weight` | number | Yes | Scoring weight 0–100 |
| `cooldownSeconds` | number | Yes | Seconds before rule can re-evaluate (min 0) |

### Condition Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `field` | string | Yes | Data field to evaluate (see supported fields below) |
| `operator` | enum | Yes | `">"`, `"<"`, `">="`, `"<="`, `"=="`, `"!="` |
| `threshold` | number or string | Yes | Value to compare against |
| `logic` | enum | No | `"AND"` (default), `"OR"`, or `"NOT"` |

## Supported Condition Field Names

### Market Data Fields

| Field | Description |
|---|---|
| `price` | Current price in USD |
| `price_change` | % change over ~1 minute |
| `price_change_1m` | Alias for `price_change` |
| `price_change_5m` | % change over ~5 minutes |
| `price_drop` | Positive value when price fell, 0 when price rose |
| `price_rise` | Positive value when price rose, 0 when price fell |
| `volume_change` | % change in volume over ~1 minute |
| `volume_change_1m` | Alias for `volume_change` |
| `volume_spike` | Positive volume change only |

### Agent Self-State Fields

| Field | Description |
|---|---|
| `balance` | Agent's SOL balance |
| `last_trade_result` | Last action: `"buy"`, `"sell"`, `"transfer"`, or `"none"` |
| `consecutive_errors` | Consecutive error count |
| `tick_count` | Total evaluation count |
| `status` | Lifecycle status: `"idle"`, `"active"`, `"cooldown"`, `"error"`, `"stopped"` |
| `position_size` | % of balance allocated (0–100) |
| `consecutive_wins` | Successive successful actions |
| `last_trade_amount` | SOL amount of last trade |

### Inter-Agent Peer Fields

Format: `peer.<AgentName>.<subField>`

Example: `peer.Conservative.last_action`

| SubField | Description |
|---|---|
| `last_action` | Peer's last action |
| `last_trade_result` | Alias for `last_action` |
| `balance` | Peer's SOL balance |
| `status` | Peer's lifecycle status |
| `consecutive_errors` | Peer's error count |
| `position_size` | Peer's position % |
| `consecutive_wins` | Peer's win streak |
| `last_trade_amount` | Peer's last trade amount |
| `tick_count` | Peer's evaluation count |

Peer lookup is case-insensitive by agent `name`, with fallback to numeric agent ID. Returns `0` (or `"none"` for action fields) if the peer is not found.

## Logical Operators

Conditions are grouped by their `logic` field. **All groups must pass** for a rule to match.

- **AND** (default): All AND conditions must be true
- **OR**: At least one OR condition must be true
- **NOT**: Each condition's result is inverted, then all must be true

Example with mixed logic:

```json
[
  { "field": "price_drop", "operator": ">", "threshold": 5, "logic": "AND" },
  { "field": "balance", "operator": ">", "threshold": 0.1, "logic": "AND" },
  { "field": "volume_spike", "operator": ">", "threshold": 100, "logic": "OR" },
  { "field": "price_drop", "operator": ">", "threshold": 10, "logic": "OR" }
]
```

Evaluates as: `(price_drop > 5 AND balance > 0.1) AND (volume_spike > 100 OR price_drop > 10)`

## Weighted Scoring

1. Each matched rule contributes its `weight` to its action's total score
2. Rules are grouped by action type (`buy`, `sell`, etc.) and weights are summed per action
3. The highest-scoring action wins
4. **Execution threshold = 70** — action executes only if the total weight >= 70
5. Below threshold → no action taken

This means a single rule with weight 75 fires on its own, but rules with lower weights (e.g., 50 and 40) must both match to exceed the threshold together. See `dip-buyer.json` for this pattern.

## Cooldown Behavior

- Each rule has independent cooldown tracking
- After a rule contributes to an executed action, it cannot be re-evaluated until `cooldownSeconds` elapses
- Cooldowns reset on agent restart
- During cooldown, the rule is skipped entirely (not evaluated)

## Quick Start: Create Your Own Agent

Minimal config template:

```json
{
  "name": "My Agent",
  "strategy": "My Strategy",
  "intervalMs": 5000,
  "rules": [
    {
      "name": "Buy on dip",
      "conditions": [
        { "field": "price_drop", "operator": ">", "threshold": 3 }
      ],
      "action": "buy",
      "amount": 0.01,
      "weight": 75,
      "cooldownSeconds": 60
    }
  ]
}
```

Save as a `.json` file in `examples/rules/`, and if the demo is running in interactive mode, the agent will hot-reload it automatically.

## Learning Progression

1. **`conservative.json`** — Start here. Two single-condition rules showing basic buy/sell triggers with high thresholds and long cooldowns.

2. **`dip-buyer.json`** — Adds compound conditions (AND with 3 conditions, OR with 2 conditions) and weighted scoring where two rules must fire together to exceed the threshold.

3. **`momentum.json`** — Adds inter-agent dependencies (`peer.Conservative.last_action`) and NOT logic for contrarian strategies. Shows how agents can react to each other's behavior.
