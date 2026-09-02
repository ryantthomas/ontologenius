# Evidence base

Every mechanism in this system traces to a published result. This file is the
contract: a feature that cannot cite a study here does not get built.

Every journal citation carries a DOI checked against the publisher record. Books
and book chapters predate DOI assignment and are marked as such rather than given
a substitute link.

---

## 1. The graph is scaffolding — retrieval is the intervention

**Design rule:** building or reading the knowledge graph is *not* counted as
learning. Progress only advances through answered retrieval items.

- Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more
  learning than elaborative studying with concept mapping. *Science*, 331(6018),
  772–775. <https://doi.org/10.1126/science.1199327>
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking
  memory tests improves long-term retention. *Psychological Science*, 17(3),
  249–255. <https://doi.org/10.1111/j.1467-9280.2006.01693.x>
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T.
  (2013). Improving students' learning with effective learning techniques.
  *Psychological Science in the Public Interest*, 14(1), 4–58.
  <https://doi.org/10.1177/1529100612453266> — rates practice testing and
  distributed practice as the only two **high-utility** techniques of the ten
  reviewed.

The first result is why the concept map is a navigation and structuring device in
the UI, and never the thing the progress bar measures.

## 2. Scheduling: distributed practice

**Implementation:** `ts-fsrs`. Each item carries FSRS stability/difficulty state;
due items drive the study queue.

- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006).
  Distributed practice in verbal recall tasks: A review and quantitative
  synthesis. *Psychological Bulletin*, 132(3), 354–380.
  <https://doi.org/10.1037/0033-2909.132.3.354>
- Ebbinghaus, H. (1885). *Über das Gedächtnis.* Book — the forgetting curve
  FSRS's memory model descends from.
- FSRS / Free Spaced Repetition Scheduler — open-spaced-repetition project;
  DSR (difficulty–stability–retrievability) memory model.

## 3. Mastery estimation: Bayesian Knowledge Tracing

**Implementation:** four parameters per concept (`p_init`, `p_learn`, `p_slip`,
`p_guess`); posterior `p_known` updated after each answer.

- Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing: Modeling the
  acquisition of procedural knowledge. *User Modeling and User-Adapted
  Interaction*, 4(4), 253–278. <https://doi.org/10.1007/BF01099821>
- Pelánek, R. (2016). Applications of the Elo rating system in adaptive
  educational systems. *Computers & Education*, 98, 169–179.
  <https://doi.org/10.1016/j.compedu.2016.03.017> — the documented fallback if
  BKT parameter fitting proves unstable on sparse per-user data.

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
  knowledge. *International Journal of Man-Machine Studies*, 23(2), 175–196.
  <https://doi.org/10.1016/S0020-7373(85)80031-6> — knowledge space theory; the
  formal basis for ordering concepts by prerequisite closure rather than by
  chapter number.
- Vygotsky, L. S. (1978). *Mind in Society.* Book — zone of proximal development;
  the informal statement of the same targeting rule.

## 5. How much to introduce at once

**Design rule:** a session introduces a bounded number of *new* concepts, with
the remainder of the session drawn from due reviews.

- Sweller, J. (1988). Cognitive load during problem solving: Effects on learning.
  *Cognitive Science*, 12(2), 257–285.
  <https://doi.org/10.1207/s15516709cog1202_4>

## 6. Item mix and ordering

**Design rule:** mixed item types drawn from related-but-distinct concepts, not
blocked by concept.

- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves
  learning. *Instructional Science*, 35, 481–498.
  <https://doi.org/10.1007/s11251-007-9015-8> — interleaving.
- Bjork, R. A., & Bjork, E. L. (2011). Making things hard on yourself, but in a
  good way: Creating desirable difficulties to enhance learning. Book chapter,
  in *Psychology and the Real World.*

## 7. Item format

**Design rule:** cloze (fill-in-the-blank) items are preferred where a single
term is the target; multiple choice is used where discrimination between
confusable concepts is the objective, and its distractors are drawn from
`Misconception` nodes and sibling concepts rather than invented at random.

- Slamecka, N. J., & Graf, P. (1978). The generation effect: Delineation of a
  phenomenon. *Journal of Experimental Psychology: Human Learning and Memory*,
  4(6), 592–604. <https://doi.org/10.1037/0278-7393.4.6.592> — why producing an
  answer beats recognizing one.
- Little, J. L., Bjork, E. L., Bjork, R. A., & Angello, G. (2012).
  Multiple-choice tests exonerated, at least of some charges. *Psychological
  Science*, 23(11), 1337–1344. <https://doi.org/10.1177/0956797612443370> —
  competitive distractors make MCQ retrieval-effective.

## 8. Feedback

**Design rule:** every answer receives corrective feedback naming the correct
answer and linking back to the concept node and its source.

- Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of
  Educational Research*, 77(1), 81–112.
  <https://doi.org/10.3102/003465430298487>
- Butler, A. C., & Roediger, H. L. (2008). Feedback enhances the positive effects
  and reduces the negative effects of multiple-choice testing. *Memory &
  Cognition*, 36(3), 604–616. <https://doi.org/10.3758/MC.36.3.604>

## 9. Mastery threshold rather than coverage

**Design rule:** a concept is "learned" at a `p_known` threshold, not at
"reviewed once." Topic completion is the share of concepts past threshold.

- Bloom, B. S. (1984). The 2 sigma problem: The search for methods of group
  instruction as effective as one-to-one tutoring. *Educational Researcher*,
  13(6), 4–16. <https://doi.org/10.3102/0013189X013006004>

## 10. The knowledge and cognitive-process taxonomies

**Implementation:** database-level enums on every concept and item.

- Anderson, L. W., & Krathwohl, D. R. (Eds.) (2001). *A Taxonomy for Learning,
  Teaching, and Assessing: A Revision of Bloom's Taxonomy of Educational
  Objectives.* Book.
- Bloom, B. S. (Ed.) (1956). *Taxonomy of Educational Objectives.* Book.

## 11. Vocabulary layer

**Implementation:** SKOS semantics for labels and hierarchy.

- Miles, A., & Bechhofer, S. (2009). *SKOS Simple Knowledge Organization System
  Reference.* W3C Recommendation. <https://www.w3.org/TR/skos-reference/>

## 12. Grain size: decomposing a concept until it is learnable

**Design rule:** a concept the learner keeps failing is not re-drilled at the
same grain. It is broken into its constituent parts, those are learned
separately, and the composite is then reassessed as the sum of its parts.

This is the one mechanism here that changes the *graph* in response to
performance rather than only the schedule. Two things follow from the
literature:

**Grain size is a property of the model, not of the subject matter.** The
knowledge-component framework treats "what counts as one thing to be learned" as
a modelling decision that can be wrong, and wrong in a detectable way: if a
learner's error rate on a component fails to fall with practice, the component is
probably several components wearing one label.

**Splitting is a data-driven operation.** Learning Factors Analysis is precisely
the procedure of refining a cognitive model by splitting a knowledge component
when response data says a single skill is really several. We do the qualitative
version of it — the model proposes the split, the response data triggers it.

`PART_OF` is deliberately a different relation from `BROADER`. `BROADER` is
taxonomic (a partition *is a kind of* topic subdivision); `PART_OF` is
meronymic (an in-sync replica set *is part of* the replication protocol).
Conflating partonomy with taxonomy is a classic ontology error, and here they
also behave differently: mastering every subtype of a thing does not mean you
have mastered the thing, whereas mastering every part is exactly the claim
composition makes.

- Koedinger, K. R., Corbett, A. T., & Perfetti, C. (2012). The
  Knowledge-Learning-Instruction framework: Bridging the science-practice chasm
  to enhance robust student learning. *Cognitive Science*, 36(5), 757–798.
  <https://doi.org/10.1111/j.1551-6709.2012.01245.x> — knowledge components and
  the consequences of their grain size.
- Cen, H., Koedinger, K., & Junker, B. (2006). Learning Factors Analysis — a
  general method for cognitive model evaluation and improvement. *Intelligent
  Tutoring Systems (ITS 2006)*, LNCS 4053, 164–175.
  <https://doi.org/10.1007/11774303_17> — splitting a knowledge component when
  performance data shows it is not atomic.
- Sweller (1988), §5 — why the parts have to be learned before the composite:
  assessing the whole while its parts are unlearned is the load problem stated
  in a different form.
