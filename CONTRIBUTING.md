# hello world
# 寮€鍙戞寚鍗?## 鍒嗘敮绠＄悊

- `master`: 璺熼殢宸插彂甯冪殑鏈€鏂扮増鏈彿
- `version/x.x.x`锛氫笅涓€涓増鏈殑浠ｇ爜
- `feature/xxx`锛氭柊鍔熻兘寮€鍙?- `fix/xxx`锛歜ug淇敼
- `refactor/xxx`锛氫唬鐮侀噸鏋?
涓嬩竴鐗堟湰浠ｇ爜缁熶竴鍚堝苟鍒?`version/x.x.x` 鍒嗘敮锛屽彂甯冨悗鍚堝苟鑷?master 骞跺垹闄?`version/x.x.x`


## IDE 鎻掍欢閰嶇疆

- Code Spell Checker
- EditorConfig for VS Code
## 寮€鍙戞楠?
浣跨敤 yarn workspace 鍒嗗寘绠＄悊锛岄」鐩牳蹇冧唬鐮佸湪 `packages` 鐩綍涓?- `@weibot/adapters`: 鍚勫钩鍙板彂甯?Driver 闆嗗悎
- `web-extension`: Chrome 鎻掍欢
- `markdown-editor`: 鍦ㄧ嚎 Markdown 缂栬緫鍣?
### 鍒濆鍖?
yarn锛堝繀椤伙級锛岀敱浜?npm workspace 鍔熻兘骞朵笉鎴愮啛锛岃閫夋嫨浣跨敤 yarn

鏍圭洰褰曚笅 `yarn install` 鍗冲彲瀹夎鎵€鏈変緷璧?
### 鎻掍欢寮€鍙?
``` bash
# 鏍圭洰褰?yarn workspace web-extension start
# 鎴栬€咃紝鍦?web-extension 鐩綍涓?yarn start
```

鎻掍欢鐩綍涓?`dist` 鏂囦欢澶规嫋鍏ユ祻瑙堝櫒鎻掍欢绠＄悊鐣岄潰

### Markdown缂栬緫鍣ㄥ紑鍙?``` bash
# 鏍圭洰褰?yarn workspace markdown-editor start
# 鎴栬€咃紝鍦?markdown-editor 鐩綍涓?yarn start
```
璺熼殢鍛戒护琛屾彁绀哄湪娴忚鍣ㄦ煡鐪嬫晥鏋滐紝宸查厤缃儹鏇存柊锛屾棤闇€鎵嬪姩鍒锋柊

### driver-devtool 寮€鍙?``` bash
# 鏍圭洰褰?yarn workspace driver-devtool start
# 鎴栬€咃紝鍦?driver-devtool 鐩綍涓?yarn start
```
璺熼殢鍛戒护琛屾彁绀哄湪娴忚鍣ㄦ煡鐪嬫晥鏋滐紝宸查厤缃儹鏇存柊锛屾棤闇€鎵嬪姩鍒锋柊

### Driver闆嗗悎寮€鍙?
`packages/@weibot/adapters` 鐩綍涓嬬洿鎺ュ紑鍙戝嵆鍙?
## 渚濊禆绠＄悊

``` bash
# 寮€鍙戠幆澧冪浉鍏崇殑渚濊禆锛屾瘮濡?webpack 鎻掍欢銆乥abel閰嶇疆锛屽湪鏍圭洰褰曚笅缁存姢锛屾坊鍔犲懡浠や负
yarn add [repo-name] -DW

# 鍏朵粬鍚勫寘鑷闇€瑕佺殑渚濊禆锛屽湪鍚勮嚜绌洪棿缁存姢锛屾坊鍔犲懡浠や负
yarn workspace [package-name] add [repo-name]
# 鎴栬€呭湪鍖呯洰褰曚笅
yarn add [repo-name]
```

## 浠ｇ爜鎻愪氦

浠ｇ爜鎻愪氦瑙勮寖閬靛惊 conventional-changelog + lerna-scope 瑙勫垯

鍛戒护琛屼娇鐢?`git commit` 杩涘叆寮曞浜や簰娴佺▼

```
<type>[scope]: <description>

[body]

[footer]
```

- type
  - feat: 涓€涓柊鍔熻兘
  - fix: 涓€涓?Bug 淇
  - perf: 鎬ц兘浼樺寲鐩稿叧鐨勪唬鐮佹洿鏀?  - refactor: 闈炰慨澶岯ug銆侀潪澧炲姞鏂板姛鑳界殑浠ｇ爜淇敼
  - test: 澧炲姞缂哄け鐨勬祴璇曟垨淇敼宸插瓨鍦ㄧ殑娴嬭瘯
  - build: 鏇存敼鐩稿叧鐨勬瀯寤虹郴缁熸垨棰濆鐨勪緷璧栵紙姣斿锛歡ulp銆乶pm銆乥roccoli锛?  - ci: 鏇存敼 CI 鐩稿叧鐨勯厤缃枃浠舵垨鑴氭湰锛堟瘮濡? Travis, Circle, BrowserStack, SauceLabs锛?  - docs: 鍙慨鏀规枃妗?  - revert: 鍥炴粴涔嬪墠鐨勬彁浜?  - style: 涓嶅奖鍝嶄唬鐮侀€昏緫鐨勬牸寮忓寲淇敼锛堟瘮濡傦細white-space, formatting, missing semi-colons锛?  - chore: 鏈慨鏀?src 鍜?test 鏂囦欢鐨勫叾浠栨洿鏀癸紝姣斿鏇存崲 public 涓嬬殑鍥剧墖
- scope: 閫夋嫨淇敼鐨勫寘
  - web-extension
  - markdown-editor
  - driver-devtool
  - @weibot/adapters
  - empty
- description: 绠€鍗曟弿杩拌姝ゆ彁浜わ紝闄愬埗100涓瓧绗?