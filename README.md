# Who wants to be a TraffiCalm Technician!

A browser-based training game with 15 scored questions, three lifelines, and an optional five-question tutorial. Open `docs/index.html` to play locally.

## Publish with GitHub Pages

1. Extract the ZIP and add its contents to your repository's `main` branch. The repository root should contain `docs/`, `src/`, and `build.py`.
2. In the repository's **Settings → Pages**, select **Deploy from a branch**. Choose `main` and `/docs`, then save.
3. Open the link shown under **Settings → Pages** once deployment finishes.

`docs/index.html` is already built. GitHub Pages can be publicly accessible even when its repository is private. The quiz presents its questions and answer key in the page source, so confirm the bank is approved for your intended audience before publishing. Scores are stored in the current browser. [GitHub Pages publishing guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [GitHub Pages visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## Update questions

1. Edit `src/questions.json`. Keep the correct answer first in each `options` list, followed by the three other choices. The game shuffles all four when it displays them.
2. Keep each question's ID stable when changing its wording or answer choices. The ID prefix controls where the question appears.

| Prefix | Questions |
| --- | --- |
| `W01`–`W05` | Tutorial, in order |
| `F` | Round 1, Q6–10 |
| `D` | Round 2, Q11–14 |
| `B` | Round 3, Q15–19 |
| `M` | Final, Q20 |

3. From the repository folder, run `py build.py` on Windows or `python3 build.py` on macOS or Linux. Open the rebuilt `docs/index.html` to test, then commit the question file and the rebuilt page.
