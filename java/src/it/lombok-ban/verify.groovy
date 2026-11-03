// #821 negative fixture 断言：失败必须是 enforcer bannedDependencies 的预期报错，
// 而不是 parent 解析失败等无关错误（防止 fixture 因配置错误而假绿）。
def log = new File(basedir, 'build.log').text
assert log.contains('banned via the exclude/include list') : 'expected enforcer bannedDependencies failure in build.log'
assert log.contains('org.projectlombok:lombok') : 'expected lombok dependency named in the enforcer failure'
