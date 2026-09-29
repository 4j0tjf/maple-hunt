using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using WzComparerR2.WzLib;

// WzComparerR2에 포함된 라이브러리를 통해 설치된 게임 파일을 읽기만 한다.
// 이미지/음원은 내보내지 않고 사냥 계산에 필요한 수치와 이름만 추출한다.
public static class WzHuntingExtractor
{
    public sealed class Monster { public string id { get; set; } public string name { get; set; } public int level { get; set; } public int count { get; set; } }
    public sealed class Map { public string id { get; set; } public string name { get; set; } public string streetName { get; set; } public int mobCount { get; set; } public double monsterLevel { get; set; } public Monster[] monsters { get; set; } }
    public sealed class Catalog { public string version { get; set; } public Map[] maps { get; set; } }
    public sealed class Result { public Catalog catalog { get; set; } public Dictionary<string,int> skipped { get; set; } public string[] errors { get; set; } public int mapImages { get; set; } public int mobImages { get; set; } }
    sealed class MobInfo { public int level; public bool boss; }
    static Wz_Node Child(Wz_Node node, string name) => node?.Nodes[name];
    static string Text(Wz_Node node) => node?.Value?.ToString();
    static int Number(Wz_Node node, int fallback = 0) => int.TryParse(Text(node), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : fallback;
    static Wz_Node Extract(Wz_Image image) {
        Exception error;
        if (!image.TryExtract(out error)) throw new InvalidDataException("이미지 추출 실패: " + image.Name, error);
        return image.Node;
    }
    static void IndexImages(Wz_Node node, Dictionary<string,Wz_Image> images) {
        foreach (var child in node.Nodes) {
            if (child.Value is Wz_Image image) {
                var id = child.Text.EndsWith(".img") ? child.Text.Substring(0, child.Text.Length - 4) : "";
                if (id.Length > 0 && id.All(char.IsDigit)) images[id] = image;
            } else IndexImages(child, images);
        }
    }
    static Wz_Node MapLife(string id, Dictionary<string,Wz_Image> images, HashSet<string> visited) {
        if (!visited.Add(id) || !images.TryGetValue(id, out var image)) throw new InvalidDataException("맵 링크 누락/순환: " + id);
        var node = Extract(image);
        var linked = Text(Child(Child(node, "info"), "link"));
        return string.IsNullOrEmpty(linked) ? Child(node, "life") : MapLife(linked.PadLeft(9, '0'), images, visited);
    }
    static MobInfo ReadMob(string id, Dictionary<string,Wz_Image> images, Dictionary<string,MobInfo> cache, HashSet<string> visited) {
        if (cache.TryGetValue(id, out var cached)) return cached;
        if (!visited.Add(id) || !images.TryGetValue(id, out var image)) throw new InvalidDataException("몬스터 누락/순환: " + id);
        try {
            var info = Child(Extract(image), "info");
            var level = Number(Child(info, "level"), -1);
            var bossNode = Child(info, "boss");
            MobInfo parent = null;
            var link = Text(Child(info, "link"));
            if ((level < 1 || bossNode == null) && !string.IsNullOrEmpty(link)) parent = ReadMob(link.PadLeft(7, '0'), images, cache, visited);
            var result = new MobInfo { level = level > 0 ? level : parent?.level ?? -1, boss = bossNode != null ? Number(bossNode) != 0 : parent?.boss ?? false };
            cache[id] = result; return result;
        } finally { image.Unextract(); }
    }
    public static Result Run(string gameDirectory) {
        var structures = new List<Wz_Structure>();
        var errors = new List<string>(); var skipped = new Dictionary<string,int>();
        Action<string> skip = reason => skipped[reason] = skipped.TryGetValue(reason, out var n) ? n + 1 : 1;
        Func<string,Wz_Structure> load = file => {
            var s = new Wz_Structure(); structures.Add(s);
            if (file.EndsWith(".ms", StringComparison.OrdinalIgnoreCase)) s.LoadMsFile(file);
            else if (File.Exists(Path.ChangeExtension(file, ".ini"))) s.LoadKMST1125DataWz(file, null);
            else s.Load(file, false);
            return s;
        };
        try {
            var data = Path.Combine(gameDirectory, "Data");
            var strings = load(Path.Combine(data, "String", "String.wz"));
            var nameImage = strings.WzNode.Nodes["Map.img"]?.Value as Wz_Image;
            if (nameImage == null) throw new InvalidDataException("String/Map.img 없음");
            var names = new Dictionary<string,(string name,string street)>();
            foreach (var region in Extract(nameImage).Nodes) foreach (var entry in region.Nodes) {
                if (int.TryParse(entry.Text, out var id)) names[id.ToString("D9")] = (Text(Child(entry,"mapName")), Text(Child(entry,"streetName")) ?? "");
            }
            var mobNames = new Dictionary<string,string>();
            if (strings.WzNode.Nodes["Mob.img"]?.Value is Wz_Image mobNameImage)
                foreach (var entry in Extract(mobNameImage).Nodes) mobNames[entry.Text.PadLeft(7,'0')] = Text(Child(entry,"name"));
            var maps = new Dictionary<string,Wz_Image>();
            var mapRoot = Path.Combine(data, "Map", "Map");
            foreach (var directory in Directory.GetDirectories(mapRoot).OrderBy(p => p)) {
                var stem = Path.GetFileName(directory);
                if (stem.Length != 4 || !stem.StartsWith("Map") || !char.IsDigit(stem[3])) continue;
                IndexImages(load(Path.Combine(directory, stem + ".wz")).WzNode, maps);
            }
            var mobs = new Dictionary<string,Wz_Image>();
            var mobWz = Path.Combine(data, "Mob", "Mob.wz");
            if (File.Exists(mobWz)) IndexImages(load(mobWz).WzNode, mobs);
            var packRoot = Path.Combine(data, "Packs");
            if (Directory.Exists(packRoot)) foreach (var file in Directory.GetFiles(packRoot,"Mob_*.ms").OrderBy(p => p)) IndexImages(load(file).WzNode, mobs);
            var cache = new Dictionary<string,MobInfo>(); var output = new List<Map>();
            foreach (var pair in maps.OrderBy(p => p.Key)) {
                var visited = new HashSet<string>();
                try {
                    if (!names.TryGetValue(pair.Key, out var label) || string.IsNullOrWhiteSpace(label.name) || label.name.Length > 40) { skip("이름 없음/길이 초과"); continue; }
                    var node = Extract(pair.Value); var info = Child(node,"info");
                    if (Number(Child(info,"town")) != 0 || Number(Child(info,"standAlone")) != 0 || Number(Child(info,"partyStandAlone")) != 0 || Number(Child(info,"timeLimit")) > 0) { skip("마을/개인/시간제 맵"); continue; }
                    var life = MapLife(pair.Key, maps, visited);
                    if (Number(Child(life,"isCategory")) != 0) { skip("조건별 몬스터 배치"); continue; }
                    var counts = new Dictionary<string,int>();
                    if (life != null) foreach (var spawn in life.Nodes) {
                        if (Text(Child(spawn,"type")) != "m" || Number(Child(spawn,"mobTime")) != 0 || Number(Child(spawn,"hide")) != 0) continue;
                        var id = Text(Child(spawn,"id"));
                        if (string.IsNullOrEmpty(id)) throw new InvalidDataException("몬스터 ID 없음");
                        id = id.PadLeft(7,'0'); counts[id] = counts.TryGetValue(id, out var count) ? count + 1 : 1;
                    }
                    var members = new List<Monster>();
                    foreach (var spawn in counts) {
                        var mob = ReadMob(spawn.Key, mobs, cache, new HashSet<string>());
                        if (mob.boss) continue;
                        if (mob.level < 1 || mob.level > 300) throw new InvalidDataException("몬스터 레벨 범위: " + spawn.Key);
                        members.Add(new Monster { id=spawn.Key, name=mobNames.TryGetValue(spawn.Key,out var name) ? name ?? spawn.Key : spawn.Key, level=mob.level, count=spawn.Value });
                    }
                    var total = members.Sum(m => m.count);
                    if (total < 1 || total > 500) { skip("일반 반복 몬스터 없음/개수 범위 초과"); continue; }
                    output.Add(new Map { id=pair.Key, name=label.name, streetName=label.street, mobCount=total, monsterLevel=members.Sum(m => (double)m.level*m.count)/total, monsters=members.ToArray() });
                } catch(Exception error) { errors.Add(pair.Key + ": " + error.Message); }
                finally { pair.Value.Unextract(); foreach(var id in visited) if(maps.TryGetValue(id,out var img)) img.Unextract(); }
            }
            var version = "KMS-WZ" + strings.wz_files[0].Header.WzVersion + "-" + DateTime.UtcNow.ToString("yyyy-MM-dd");
            return new Result { catalog=new Catalog { version=version,maps=output.ToArray() }, skipped=skipped, errors=errors.ToArray(), mapImages=maps.Count, mobImages=mobs.Count };
        } finally { foreach(var structure in structures) structure.Clear(); }
    }
}
