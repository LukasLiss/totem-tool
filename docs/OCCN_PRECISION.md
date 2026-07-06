# Precision for Object-Centric Causal Nets

This document defines the precision notion implemented in
`totem_lib.occn_precision` and explains the algorithm that computes it. The
notion generalizes the escaping-edges precision for object-centric Petri nets
by Adams & van der Aalst (*Precision and Fitness in Object-Centric Process
Mining*, ICPM 2021) to object-centric causal nets (OCCNs, Liss et al.,
*Object-Centric Causal Nets*, CAiSE 2025), whose binding semantics and fitness
notion are given in Liss & van der Aalst (*Object-Centric Conformance Checking
on Object-Centric Causal Nets*).

**Idea.** A model is imprecise where it allows behavior that is never
observed. For every event of the log we determine its *context* — everything
that had to happen before the event could occur. We then compare, per context,
the behavior the *log* shows (which activities actually follow this context)
with the behavior the *model* allows (which activities the OCCN enables in any
state it can be in after this context). Model behavior that never occurs in
the log for that context are the *escaping edges*; the precision is the
average share of allowed behavior that is also observed.

## 1 Preliminaries

**Definition 1 (Object-centric event log).**
An object-centric event log is a tuple
$L = (E, O, OT, \pi_{act}, \pi_{obj}, \pi_{time})$ where $E$ is a set of
events, $O$ a set of objects, $OT = \{\pi_{type}(o) \mid o \in O\}$ the object
types, $\pi_{act}: E \to \mathcal{U}_{act}$ assigns each event an activity,
$\pi_{obj}: E \to \mathcal{P}(O) \setminus \{\emptyset\}$ assigns each event
its objects, and $\pi_{time}: E \to \mathcal{U}_{time}$ assigns each event a
timestamp. We assume a total order $\le$ on $E$ that is consistent with
$\pi_{time}$ (the implementation breaks timestamp ties by the order of the
events in the log). We write $e' < e$ for $e' \le e \wedge e' \neq e$.

**Definition 2 (Object-centric causal net).**
An OCCN is a tuple $\mathit{OCCN} = (N, l, D, \mathit{inp}, \mathit{outp})$ of
activity nodes $N$, labels $l$, typed dependency arcs
$D \subseteq N \times \mathcal{U}_{type} \times N$, and input/output *marker
groups* $\mathit{inp}(n), \mathit{outp}(n)$ per node. A marker
$(n', ot, (c_{min}, c_{max}), k)$ of a group constrains how many objects of
type $ot$ flow along the arc from/to $n'$ in one execution
($c_{min} \le \cdot \le c_{max}$); markers sharing a key $k$ within one group
must bind disjoint objects. Every object type $ot$ has an artificial start
activity $\blacktriangleright_{ot}$ (no input marker groups) and end activity
$\blacksquare_{ot}$ (no output marker groups); start and end activities
process objects individually.

The *state* of an OCCN is a multiset of pending obligations
$s \in \mathcal{B}(N \times \mathcal{U}_{obj} \times N)$: $(n, o, n')$ means
activity $l(n')$ still has to happen for object $o$ as a causal consequence of
$n$. A *binding* $b = (n, C, P)$ executes the activity of node $n$, consuming
the obligations $C$ (pairs $(n', o)$ of a predecessor node and an object) and
producing the obligations $P$ (pairs $(o, n')$ of an object and a successor
node); it must satisfy one
input and one output marker group of $n$ (cardinalities and key
disjointness), and for visible activities the objects of $C$ and $P$
coincide. Executing a binding in state $s$ yields
$s' = (s \setminus \biguplus_{(n',o) \in C} (n', o, n)) \uplus
\biguplus_{(o,n') \in P} (n, o, n')$; we write
$s \xrightarrow{b} s'$, and $s \xrightarrow{\sigma} s'$ for a sequence
$\sigma$ of bindings. Bindings are only enabled if all consumed obligations
are pending. Every binding corresponds to the observable event
$(l(n), \mathit{objects}(C \cup P))$; start and end activities are invisible
(they are not recorded in logs).

## 2 Contexts: Linking Log and Model

An event with multiple objects has no single history: each of its objects has
its own past, and pasts of different objects influence each other through
shared events. Following Adams & van der Aalst, we capture "everything that
had to happen before an event" with the event-object graph.

**Definition 3 (Event-object graph, event preset).**
The event-object graph of $L$ is the directed graph $G_L = (E, K)$ with
$K = \{(e', e) \in E \times E \mid e' < e \wedge \pi_{obj}(e') \cap
\pi_{obj}(e) \neq \emptyset\}$. The *event preset* $\circ e$ of an event $e$
is the set of all events with a directed path to $e$ in $G_L$:

$$\circ e \;=\; \{\, e' \in E \mid e' \xrightarrow{\;K^{+}\;} e \,\}.$$

The preset contains exactly the events on which $e$ transitively depends
through shared objects — also across object types (if a plane event depends
on a loading event, it also depends on the check-in of the loaded baggage).
Events that merely happened earlier but are causally unrelated to $e$ are
*not* in $\circ e$.

**Definition 4 (Prefix of an object, context of an event).**
For an object $o$ and an event $e$, the *prefix* of $o$ before $e$ is the
sequence of activities of the preset events involving $o$, in log order:

$$\circ e{\downarrow}o \;=\; \langle \pi_{act}(e_1), \ldots, \pi_{act}(e_m)
\rangle \quad \text{with } \{e_1 < \cdots < e_m\} = \{e' \in \circ e \mid o
\in \pi_{obj}(e')\}.$$

The *context* of $e$ maps each object type to the multiset of prefixes of all
objects appearing in $\circ e$ or in $e$ itself:

$$\mathit{context}_e(ot) \;=\; [\, \circ e{\downarrow}o \;\mid\; o \in
\textstyle\bigcup_{e' \in \circ e \cup \{e\}} \pi_{obj}(e') \,\wedge\,
\pi_{type}(o) = ot \,].$$

Objects of $e$ that occur for the first time in $e$ contribute the empty
prefix $\langle\rangle$. The context is invariant under renaming of objects
and abstracts both from the interleaving of causally unrelated events and
from how objects are grouped into events — two events with equal contexts
have, up to renaming of objects, the same per-object activity histories.

## 3 Enabled Log and Model Behavior

**Definition 5 (Enabled log activities).**
The behavior the log exhibits for the context of an event $e$ is the set of
activities of all events with the same context:

$$\mathit{en}_L(e) \;=\; \{\, \pi_{act}(e') \mid e' \in E \,\wedge\,
\mathit{context}_{e'} = \mathit{context}_e \,\}.$$

Note that $\pi_{act}(e) \in \mathit{en}_L(e)$ always holds.

On the model side we consider the states the OCCN can be in after exhibiting
the causal history of the event. Following the algorithm of Adams & van der
Aalst, the model is put into these states by *replaying the observed preset*:
every preset event is executed as a binding of its activity involving exactly
its objects, in log order, and every involved object is introduced by a start
binding.

**Definition 6 (Replay states of an event).**
A binding sequence $\sigma$ *replays* an event $e$ if it consists of (i) one
start binding per object of
$\bigcup_{e' \in \circ e \cup \{e\}} \pi_{obj}(e')$, each placed before the
first binding involving its object, and (ii) for every preset event
$e' \in \circ e$, in log order, one visible binding $(n, C, P)$ with
$l(n) = \pi_{act}(e')$ whose consumed objects are exactly $\pi_{obj}(e')$.
The *replay states* of $e$ are

$$\mathit{states}(\mathit{OCCN}, e) \;=\;
\{\, s \;\mid\; [\,] \xrightarrow{\;\sigma\;} s \,\wedge\, \sigma
\text{ replays } e \,\}.$$

Because the choice of the marker groups and of the produced obligations is
not visible in the events, one event generally has many replaying binding
sequences and, thus, many replay states — this search over invisible binding
choices replaces the search over silent transitions in the object-centric
Petri net setting. The placement of the start bindings does not matter: start
bindings commute with the bindings of other objects, so any placement before
the object's first event reaches the same states.

**Definition 7 (Enabled model activities).**
The behavior the model allows for the context of $e$ is the set of visible
activities enabled in any replay state of any event with this context:

$$\mathit{en}_M(e) \;=\; \{\, l(n) \in \mathcal{U}_{A} \;\mid\; \exists\, e'
\in E\!: \mathit{context}_{e'} = \mathit{context}_e \;\wedge\; \exists\, s
\in \mathit{states}(\mathit{OCCN}, e')\; \exists\, b = (n, C,
P)\!: s \xrightarrow{b} s' \,\}.$$

Artificial start and end activities are excluded: they are not observable in
the log, so they carry no comparable behavior. Two closure arguments show
that this restriction loses nothing (see Proposition 1): executing end
bindings only removes obligations, and starting additional objects is fixed
by the context (the context determines the involved objects, including the
fresh ones with empty prefixes).

**Remark (relation to an oracle over all matching sequences).**
One could define the context states more liberally as all states reachable by
*any* binding sequence whose per-object visible activity sequences reproduce
the context — regardless of how the objects are grouped into bindings. This
is the OCCN analogue of the states-oracle of Adams & van der Aalst (their
Definition 10). Definition 6 under-approximates this oracle by replaying only
the event groupings observed in the log, exactly as the paper's Algorithm 1
does for object-centric Petri nets. In OCCNs the grouping of objects into one
binding can affect the reachable states (cardinalities and keys apply per
binding), so the two notions can differ; we deliberately measure the model
against the executions the log testifies. A consequence worth knowing when
interpreting results: $\mathit{en}_M$ is determined by the *observed* events
of a context (Definition 7 takes a union over them), so it can grow as more
events with the same context are observed.

**Proposition 1 (Monotonicity).**
Let $s_1 \le s_2$ (multiset inclusion of pending obligations). Then every
binding enabled in $s_1$ is enabled in $s_2$, and executing the same binding
preserves the inclusion. Consequently, (i) every binding sequence replayable
from $s_1$ is replayable from $s_2$ with a pointwise larger resulting state,
and (ii) the enabled visible behavior of $s_1$ is contained in that of
$s_2$.

*Proof sketch.* A binding consumes a chosen sub-multiset of the pending
obligations; a larger state offers a superset of choices, and
$s_1 - C + P \le s_2 - C + P$ holds pointwise. Induction over the sequence
gives (i); (ii) is the base case. ∎

Proposition 1 has two consequences used above and in Section 5: states in
which end bindings already fired are dominated by the states in which they
did not (ends only consume), so ignoring end closures does not change
$\mathit{en}_M$; and dominated states can be discarded during the state
search without affecting the result.

## 4 The Precision Measure

**Definition 8 (Precision).**
Let $E_f = \{ e \in E \mid \mathit{en}_M(e) \neq \emptyset \}$ be the
*replayable* events — the events for whose context at least one replay
enables visible behavior. The precision of $\mathit{OCCN}$ with respect to
$L$ is

$$\mathit{precision}(L, \mathit{OCCN}) \;=\; \frac{1}{|E_f|} \sum_{e \in E_f}
\frac{|\mathit{en}_L(e) \cap \mathit{en}_M(e)|}{|\mathit{en}_M(e)|}.$$

Events outside $E_f$ (non-replayable contexts, e.g., because the log does not
fit the model at all at this point) are skipped, exactly as in the
object-centric Petri net precision; their share is reported alongside the
metric. If $E_f = \emptyset$ the precision is defined as $0$ by convention.
The measure lies in $[0, 1]$; it is $1$ iff, for every replayable event, every
activity the model enables after the event's context is also observed after
that context somewhere in the log. The set
$\mathit{en}_M(e) \setminus \mathit{en}_L(e)$ contains the *escaping edges* of
the context — the concrete over-permissions of the model, which the
implementation reports per context for diagnostics.

### 4.1 Cardinality profiles: an OCCN-specific refinement

OCCNs can express constraints that object-centric Petri nets cannot: concrete
cardinalities and object distributions (key groups). At the granularity of
activity labels these constraints are invisible — a model allowing *send*
with $1..5$ orders and a model allowing *send* with exactly $2$ orders enable
the same activity set. The implemented measure therefore optionally compares
*profiles* instead of activities.

**Definition 9 (Profile precision).**
The profile of an event is its activity together with the number of involved
objects per type,
$\mathit{prof}(e) = (\pi_{act}(e), \{ (ot, |\{o \in \pi_{obj}(e) \mid
\pi_{type}(o) = ot\}|) \})$; the profile of a binding $(n, C, P)$ is $(l(n),
\{ (ot, |\mathit{objects}_{ot}(C)|) \})$ over its distinct consumed objects.
Replacing activities by profiles in Definitions 5, 7 and 8 — i.e.,
$\mathit{en}^{p}_L(e) = \{\mathit{prof}(e') \mid \mathit{context}_{e'} =
\mathit{context}_e\}$ and $\mathit{en}^{p}_M(e)$ the profiles of all bindings
enabled in some context state — yields the *profile precision*.

Under profile precision, a model that allows sending $1..5$ orders while the
log always sends exactly $2$ loses precision (the profiles "send 1 order",
"send 3..5 orders" escape, insofar as states offer enough objects), and
missing key groups become visible because they admit states in which too many
objects are pending toward the same activity. Since the enabled bindings are
determined by the objects pending in a state, both $\mathit{en}^{p}_L$ and
$\mathit{en}^{p}_M$ remain finite and rename-invariant.

## 5 Algorithm

The implementation computes $\mathit{en}_L$ and $\mathit{en}_M$ per *unique
context*: events with equal contexts share both sets, and $\mathit{en}_M$ is
the union of the replay behavior over the context's events (Definition 7).

```
Input:  OCEL L, OCCN, granularity, max_states
Output: precision and per-context diagnostics

1  order events by (timestamp, log order); drop untyped objects
2  compute event presets ∘e incrementally:                       (Def. 3)
       ∘e = ⋃_{o ∈ π_obj(e)} (∘last(o) ∪ {last(o)})
   where last(o) is the previous event involving o
3  compute context_e for every event; group events by context    (Def. 4)
4  en_L(ctx) = activities (profiles) of the events of ctx        (Def. 5)
5  for every event e (deduplicated by canonical replay key):
6      replay ∘e on the OCCN as a set of states:                 (Def. 6)
7          start from {[]}; process preset events in log order;
8          start each object (START binding) before its first event;
9          per state, execute every binding of the event's activity
           that involves exactly the event's objects;
10         prune the state set to its maximal antichain (Prop. 1);
           abort if it exceeds max_states
11     start the fresh objects of e; collect the visible
       activities (profiles) enabled in any resulting state      (Def. 7)
12 en_M(ctx) = union of the collected behavior over the events of ctx
13 E_f = events of contexts with en_M ≠ ∅
14 precision = (1/|E_f|) Σ_{e ∈ E_f} |en_L ∩ en_M| / |en_M|      (Def. 8)
```

The preset identity in step 2 holds because any earlier event sharing an
object with $e$ is reachable through the chain of that object's events;
presets are stored as bitmasks, so step 2 takes $O(|E|^2/w)$ time
($w$ = machine word size) and step 3 is linear in the sizes of the contexts.

**Replay (steps 6–11).** Where the Petri net algorithm replays a
fully-determined binding sequence and searches over silent transitions, the
OCCN replay searches over *binding choices*: which input/output marker group
an event uses, which pending obligations it consumes, and to which successors
it produces obligations. Four techniques keep this tractable:

- *Exact-cover binding enumeration.* For an observed event, only bindings
  consuming exactly the event's objects are relevant
  (`OCCausalNetSemantics.enabled_bindings_for_objects`). Enumeration branches
  only where an object can be consumed from several predecessors, instead of
  enumerating all sub-multisets of the pending obligations.
- *Antichain pruning.* By Proposition 1, states dominated by another state in
  the set contribute neither behavior nor replays beyond their dominator;
  after every step the state set is pruned to its maximal elements. This is
  exact, and it collapses the choices that only differ in producing fewer
  obligations.
- *Lazy starts.* Start bindings commute with bindings of other objects, so
  each object is started directly before its first event; the event then
  immediately rules out start choices that do not enable it.
- *Canonical replay caching.* Replays are cached under the preset's event
  sequence with objects renamed to first-appearance indices (types
  preserved). Equal keys imply isomorphic replays, so recurring behavior —
  the same variant executed by different objects — is replayed once.

Since all binding choices are explored, the state set can still grow
exponentially in the number of interacting objects (as can the underlying
notions for object-centric Petri nets and the OCCN fitness). The `max_states`
cap bounds the antichain size per replay; capped replays are treated as
non-replayable, and their number is reported so the approximation is visible
in the result.

The overall complexity is $O(|E|^2/w)$ for the presets plus the total size
of all contexts on the log side, plus, per unique canonical replay key, a
state-space search that is exponential in the number of interacting objects
in the worst case but bounded by $\mathit{max\_states}$.

## 6 Worked Example

Consider a flight-handling OCCN (types *plane*, *baggage*): *load* takes one
plane and 1–2 baggage; the plane then goes through *liftoff* and *unload*
(which also requires the loaded baggage); every baggage is *picked up*. As in
the object-centric Petri net of the ICPM 2021 paper, the model also allows
picking baggage up directly after loading — the output marker group of *load*
routes each baggage exclusively either to *unload* or to *pickup* (two markers
sharing a key).

Log (one process execution):
$\langle$ *load*$(p_1, b_1, b_2)$, *liftoff*$(p_1)$,
*unload*$(p_1, b_1, b_2)$, *pickup*$(b_1)$, *pickup*$(b_2)$ $\rangle$.

| event(s) $e$ | $\mathit{context}_e$ | $\mathit{en}_L$ | $\mathit{en}_M$ | term |
|---|---|---|---|---|
| load | plane $[\langle\rangle]$, baggage $[\langle\rangle^2]$ | {load} | {load} | $1$ |
| liftoff | plane $[\langle l\rangle]$, baggage $[\langle l\rangle^2]$ | {liftoff} | {liftoff, pickup} | $1/2$ |
| unload | plane $[\langle l,lo\rangle]$, baggage $[\langle l\rangle^2]$ | {unload} | {unload, pickup} | $1/2$ |
| pickup $b_1$, pickup $b_2$ | plane $[\langle l,lo,u\rangle]$, baggage $[\langle l,u\rangle^2]$ | {pickup} | {pickup} | $1$ (×2 events) |

(with $l$ = load, $lo$ = liftoff, $u$ = unload). After the
context of *liftoff*, the model can be in a state where a baggage obligation
points at *pickup*, so *pickup* is enabled in the model — but no event with
this context is a pickup in the log: *pickup* escapes. The precision is
$(1 + \tfrac12 + \tfrac12 + 1 + 1)/5 = 0.8$. Note that the pickup events do
*not* share the liftoff context — picking up baggage causally requires
*unload* and thus *liftoff* here — but they do share one context with each
other: pickup $b_1$ is not in the preset of pickup $b_2$, because the two
events share no object and there is no directed path between them in the
event-object graph.

## 7 Properties and Design Decisions

- **Faithful generalization.** The construction generalizes the
  escaping-edges *algorithm* of Adams & van der Aalst: the context
  definitions are identical, the observed events are replayed, and
  enumerating the invisible binding choices of the OCCN plays the role of
  searching over silent transitions. Both algorithms under-approximate their
  respective all-matching-sequences oracle by replaying only the observed
  event groupings (see the remark after Definition 7).
- **Only observed contexts and groupings are measured.** Like its Petri net
  counterpart, the measure evaluates the model in the states the log actually
  visits. A loop that the model allows to run longer than any observed
  execution penalizes precision only in the contexts that occur; behavior
  after unobserved contexts or unobserved object groupings is not sampled.
- **Termination is not compared.** Whether the model could *stop* where the
  log continues (or vice versa) is invisible to the measure, since end
  activities are artificial. This mirrors the Petri net notion, where
  reaching a final marking is likewise not part of the enabled activities.
- **Cardinalities and keys.** At activity granularity, over-permissive
  cardinalities and missing key groups affect the measure only indirectly
  (through the reachable states); the profile granularity of Definition 9
  makes them count directly. Both granularities are reported with the same
  diagnostics (escaping behavior per context).
- **Skipped events and the state cap.** Events with non-replayable contexts
  are excluded from the average but reported (`num_skipped_events`). A large
  skipped share signals that fitness, not precision, is the model's problem —
  precision values are then based on the remaining events. Replays aborted by
  the `max_states` cap (reported per unique cached replay in
  `num_state_capped_replays`) contribute no model behavior; their events are
  skipped only if no other event of the same context contributes behavior,
  otherwise they are averaged against the remaining, possibly smaller
  $\mathit{en}_M$. Results with a non-zero capped count are therefore
  approximations and should be read together with these counters;
  `max_states=None` computes the exact value.
- **Determinism.** The measure is a function of the log and the model; the
  implementation fixes the tie-breaking of equal timestamps (log order), so
  results are reproducible.
- **Assumptions.** As in the OCCN fitness paper: unique node labels, one
  `START_ot`/`END_ot` per object type, and start/end activities that process
  objects individually. Objects of types unknown to the model make their
  contexts non-replayable (reported as skipped); objects without a type in
  the log are ignored.

## 8 Usage

```python
from totem_lib import import_ocel, discover_occn, occn_precision

ocel = import_ocel("example_data/ocel2-p2p.json")
occn = discover_occn(ocel, relativeOccuranceThreshold=0)

result = occn_precision(ocel, occn)           # activity granularity
print(result.precision, result.num_skipped_events, result.num_events)

# OCCN-specific: cardinalities and object distributions count as well
profile_result = occn_precision(ocel, occn, granularity="profile")

# escaping behavior per context
for detail in result.context_details:
    if detail.escaping:
        print(detail.event_ids, "->", sorted(detail.escaping))
```

The OCCN can be passed as an `OCCausalNet`, as the JSON saved by the visual
OCCN editor (introduced in PR #243; its `markerGroups` field uses the
`OCCausalNet.from_dict` format), as a plain marker-groups dict, as a JSON
string, or as a path to a JSON file.

Note on runtime: with a very permissive model (e.g., an OCCN discovered from
the full P2P example log at threshold 0), the computation takes several
minutes with the default `max_states=1000` and reports the replays it had to
cap. Lower `max_states` for speed, raise it (or pass `None`) for exactness,
or restrict the computation with `event_ids`.
