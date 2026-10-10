# Codility demo test clone

A local copy of the Codility demo test page. It has the task panel, file tree (`solution.java`, `test-input.txt`), editor, timer, **Run code**, **Test Output** and **Submit Assessment**. Your code really compiles and runs in Java 21, Python 3 or JavaScript.

It ships with **no questions**. You add your own.

## Run it

```bash
npm start
```

Then open http://localhost:4141. Add `?minutes=90` to the URL to change the test length (the default is 30).

Requirements:
- Node 18+.
- For Java: a JDK. On a Mac, `brew install openjdk@21` (found automatically).
- For Python: `python3` on your PATH.

## Add a question

Create a `.md` file in `questions/`, then reload the page. Each file becomes a task tab (1, 2, 3...), in file-name order.

````markdown
# MissingInteger

Write a function:

{{signature}}

that, given an array A of N integers, returns the smallest positive integer that does not occur in A.

- N is an integer within the range [1..100,000];
- each element of array A is an integer within the range [−1,000,000..1,000,000].

## Signature
int solution(int[] A)

## Examples
[1, 3, 6, 4, 1, 2] -> 5
[1, 2, 3] -> 4

## Tests
[-1, -3] -> 1
[2] -> 1

## Time limit
1

## Solution
```java
class Solution {
    public int solution(int[] A) { ... }
}
```
````

| Section | What it does |
|---|---|
| `# Title` | Task name (optional; defaults to the file name). |
| Description | Everything before the first `##`. One paragraph per line; `- ` lines become bullets. `{{signature}}` (or a pasted `class Solution {...}` line) shows the signature box in the chosen language. |
| `## Signature` | **Required.** A Java-style signature. Types: `int long double boolean String int[] long[] double[] boolean[] String[] int[][]`. Python and JavaScript signatures are generated from it. |
| `## Examples` | `input -> expected`, one per line. Run by **Run code** and by Submit. |
| `## Tests` | Hidden tests in the same format. Only run on **Submit**. |
| `## Time limit` | Seconds per test (default 3). Python gets 4×. |
| `## Solution` | Optional code block, shown after you submit. |

Input syntax follows Codility's style: `[1, 2, 3]`, `'abc'`, `True`, `[[1, 2], [3, 4]]`. If there are several arguments, write `([1, 2, 3], 4)` or `[1, 2, 3], 4`.

**`test-input.txt`** (in the editor's file tree) takes your own cases, written the same way. Without `-> expected`, Run code just prints the returned value.

Your code and the timer are saved in the browser's local storage. `questions/*.md` is git-ignored, so your questions stay private. Remove that line from `.gitignore` if you want them committed.
