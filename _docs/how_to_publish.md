#### Steps to package & publish

```sh
npm i -g @vscode/vsce

vsce login surajmandalcell
vsce package -o _releases/
vsce publish

# To update
vsce publish patch
# patch: small, minor: medium, major: large changes
```
