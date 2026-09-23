"""生成自托管的手帐字体；只在新增界面文字时手动运行，不参与日常构建。

用法：python scripts/subset-journal-fonts.py 字体源文件目录
目录内放入 NotoSerifSC.ttf、NotoSansSC.ttf、Gaegu-Regular.ttf。
需要 fonttools[woff]。原字体来自 Google Fonts，各自的 OFL 许可随字体保留。
"""
import sys
from pathlib import Path
from fontTools import subset

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1])
# 保留界面中文、英文字母、数字与日期符号；未覆盖的用户姓名由系统字体接续。
text = ''.join(path.read_text(encoding='utf-8') for path in (root / 'src').rglob('*')
               if path.suffix in {'.ts', '.tsx'})
text += ''.join(chr(value) for value in range(32, 127))
text += '星期一二三四五六日月年月号零〇九八七六五四三二一今天签到册きょうの記録☺✳↗…—×'
for filename, output in [('NotoSerifSC.ttf', 'journal-serif.woff2'),
                         ('NotoSansSC.ttf', 'journal-sans.woff2'),
                         ('Gaegu-Regular.ttf', 'journal-hand.woff2')]:
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    font = subset.load_font(str(source / filename), options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text if 'Gaegu' not in filename else ''.join(chr(v) for v in range(32, 127)))
    subsetter.subset(font)
    subset.save_font(font, str(root / 'public' / 'fonts' / output), options)
    print(f'已生成 {output}')
