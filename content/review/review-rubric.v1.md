# Review rubric v1

For every item, a human reviewer distinct from the author must inspect the
same restricted evidence bytes bound by `reviewEvidenceSha256` and confirm all
of these checks:

1. `naturalJapanese`
2. `singleCorrectAnswer`
3. `distractorsUnambiguous`
4. `distractorRationalesAccurate`
5. `levelFit`
6. `questionTypeFormatValid`
7. `passageSelfContained`
8. `explanationSufficient`
9. `tagsAccurate`
10. `originalNoCopy`
11. `duplicateReviewComplete`
12. `noPersonalDataOrSecrets`

Every machine value is literal `true`; missing, false, or extra checks fail.
For a passage-free type, `passageSelfContained` means the explicit not-
applicable decision was reviewed. A `NEW_VERSION` additionally requires both
revision preservation checks. Machine validation cannot replace this human
review.
