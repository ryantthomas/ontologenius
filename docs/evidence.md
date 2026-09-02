# Evidence base

Every mechanism in this system traces to a published result. This file is the
contract: a feature that cannot cite a study here does not get built.

Citations are listed with enough detail to locate the DOI; each is to be replaced
with a verified DOI link as the corresponding mechanism is implemented.

---

## 1. The graph is scaffolding — retrieval is the intervention

**Design rule:** building or reading the knowledge graph is *not* counted as
learning. Progress only advances through answered retrieval items.

- Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more
  learning than elaborative studying with concept mapping. *Science*, 331(6018),
  772–775.
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking
  memory tests improves long-term retention. *Psychological Science*, 17(3),
  249–255.
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T.
  (2013). Improving students' learning with effective learning techniques.
  *Psychological Science in the Public Interest*, 14(1), 4–58. — rates practice
  testing and distributed practice as the only two **high-utility** techniques
  of the ten reviewed.

This first result is why the concept map is a navigation and structuring device
in the UI, and never the thing the progress bar measures.

## 2. Scheduling: distributed practice

**Implementation:** `ts-fsrs`. Each item carries FSRS stability/difficulty state;
due items drive the study queue.

- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006).
  Distributed practice in verbal recall tasks: A review and quantitative
  synthesis. *Psychological Bulletin*, 132(3), 354–380.
- Ebbinghaus, H. (1885). *Über das Gedächtnis* — the forgetting curve FSRS's
  memory model descends from.
- FSRS / Free Spaced Repetition Scheduler — open-spaced-repetition project;
  DSR (difficulty–stability–retrievability) memory model.

## 3. Mastery estimation: Bayesian Knowledge Tracing

**Implementation:** four parameters per concept (`p_init`, `p_learn`, `p_slip`,
`p_guess`); posterior `p_known` updated after each answer.

- Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing: Modeling the
  acquisition of procedural knowledge. *User Modeling and User-Adapted
  Interaction*, 4(4), 253–278.
- Pelánek, R. (2016). Applications of the Elo rating system in adaptive
  educational systems. *Computers & Education*, 98, 169–179. — the documented
  fallback if BKT parameter fitting proves unstable on sparse per-user data.

## 4. Prerequisite structure and the learning path

**Implementation:** `PREREQUISITE_OF` edges; the next concept offered is one
whose prerequisites are known well enough — the graph's "fringe."

**Two thresholds, not one.** Unlocking a dependent concept (0.70) is separate
from declaring a concept mastered (0.95, §9). They answer different questions:
whether the learner knows enough for the next concept to make sense, versus
whether this one is learned. Gating unlocks at the mastery criterion was tried
first and behaved badly — a graph that narrows to a single root concept offers
one question, and spacing then stalls the learner until its next review comes
due. Spaced practice on the prerequisite continues either way, so the lower
unlock bar costs little.

- Doignon, J.-P., & Falmagne, J.-C. (1985). Spaces for the assessment of
  knowledge. *International Journal of Man-Machine Studies*, 23(2), 175–196. —
  knowledge space theory; the formal basis for ordering concepts by prerequisite
  closure rather than by chapter number.
- Vygotsky, L. S. (1978). *Mind in Society* — zone of proximal development; the
  informal statement of the same targeting rule.

## 5. How much to introduce at once

**Design rule:** a session introduces a bounded number of *new* concepts, with
the remainder of the session drawn from due reviews.

- Sweller, J. (1988). Cognitive load during problem solving: Effects on learning.
  *Cognitive Science*, 12(2), 257–285.
- Sweller, J., van Merriënboer, J. J. G., & Paas, F. (1998). Cognitive
  architecture and instructional design. *Educational Psychology Review*, 10,
  251–296.

## 6. Item mix and ordering

**Design rule:** mixed item types drawn from related-but-distinct concepts, not
blocked by concept.

- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves
  learning. *Instructional Science*, 35, 481–498. — interleaving.
- Bjork, R. A., & Bjork, E. L. (2011). Making things hard on yourself, but in a
  good way: Creating desirable difficulties to enhance learning.

## 7. Item format

**Design rule:** cloze (fill-in-the-blank) items are preferred where a single
term is the target; multiple choice is used where discrimination between
confusable concepts is the objective, and its distractors are drawn from
`Misconception` nodes and sibling concepts rather than invented at random.

- Slamecka, N. J., & Graf, P. (1978). The generation effect: Delineation of a
  phenomenon. *Journal of Experimental Psychology: Human Learning and Memory*,
  4(6), 592–604. — why producing an answer beats recognizing one.
- Little, J. L., Bjork, E. L., Bjork, R. A., & Angello, G. (2012). Multiple-choice
  tests exonerated, at least of some charges. *Psychological Science*, 23(11),
  1337–1344. — competitive distractors make MCQ retrieval-effective.
- Butler, A. C., & Roediger, H. L. (2008). Feedback enhances the positive effects
  and reduces the negative effects of multiple-choice testing. *Memory &
  Cognition*, 36(3), 604–616.

## 8. Feedback

**Design rule:** every answer receives corrective feedback naming the correct
answer and linking back to the concept node and its source.

- Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of
  Educational Research*, 77(1), 81–112.
- Butler & Roediger (2008), above.

## 9. Mastery threshold rather than coverage

**Design rule:** a concept is "learned" at a `p_known` threshold, not at
"reviewed once." Topic completion is the share of concepts past threshold.

- Bloom, B. S. (1984). The 2 sigma problem: The search for methods of group
  instruction as effective as one-to-one tutoring. *Educational Researcher*,
  13(6), 4–16.

## 10. The knowledge and cognitive-process taxonomies

**Implementation:** database-level enums on every concept and item.

- Anderson, L. W., & Krathwohl, D. R. (Eds.) (2001). *A Taxonomy for Learning,
  Teaching, and Assessing: A Revision of Bloom's Taxonomy of Educational
  Objectives.*
- Bloom, B. S. (Ed.) (1956). *Taxonomy of Educational Objectives.*

## 11. Vocabulary layer

**Implementation:** SKOS semantics for labels and hierarchy.

- Miles, A., & Bechhofer, S. (2009). *SKOS Simple Knowledge Organization System
  Reference.* W3C Recommendation.
