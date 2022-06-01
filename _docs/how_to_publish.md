#### Steps to package & publish

```sh
npm i -g vsce

vsce login surajmandalcell
vsce package
vsce publish

# To update
vsce publish patch
# patch: small, minor: medium, major: large changes
```
