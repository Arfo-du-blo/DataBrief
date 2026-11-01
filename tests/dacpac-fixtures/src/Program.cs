// Builds the test .dacpac files with Microsoft's own DacFx library from the T-SQL schemas next to this file.
using Microsoft.SqlServer.Dac;
using Microsoft.SqlServer.Dac.Model;

string src = args[0], outDir = args[1];
foreach (var (file, name) in new[] { ("shop.sql", "shop.dacpac"), ("canary.sql", "CONFIDENTIAL_FILE_dacpac.dacpac") })
{
    var model = new TSqlModel(SqlServerVersion.Sql150, new TSqlModelOptions());
    foreach (var batch in File.ReadAllText(Path.Combine(src, file)).Replace("\r\n", "\n").Split("\n---\n"))
    {
        var sql = batch.Trim();
        if (sql.Length > 0) model.AddObjects(sql);
    }
    foreach (var e in model.Validate())
        Console.WriteLine($"{file}: {e.MessageType} {e.Message}");
    var path = Path.Combine(outDir, name);
    File.Delete(path);
    DacPackageExtensions.BuildPackage(path, model, new PackageMetadata { Name = Path.GetFileNameWithoutExtension(name), Version = "1.0.0" });
    Console.WriteLine($"{name}: {new FileInfo(path).Length} bytes");
}
