package com.wotb.web.archfixture;

import java.util.*;

/**
 * #821 mutation fixture：{@code SourceImportStarBanTest} 的红灯输入。
 * 下方注释、字符串、文本块中的 import * 同形文本必须被词法扫描忽略，
 * 只有真实的 {@code import java.util.*;} 允许命中——证明检查器因
 * import * 本身失败，而不是把注释/字符串误报成违规。
// import com.example.Comment.*;
 */
@SuppressWarnings("unused")
final class ImportStarFixture {

    static final String IN_STRING = "import com.example.StringLiteral.*;";

    static final String IN_TEXT_BLOCK = """
            import com.example.TextBlock.*;
            """;
}
