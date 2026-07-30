class Scripture {
  final String id;
  final String book;
  final int chapter;
  final int verse;
  final String text;
  final String volume;

  Scripture({
    required this.id,
    required this.book,
    required this.chapter,
    required this.verse,
    required this.text,
    required this.volume,
  });

  factory Scripture.fromJson(Map<String, dynamic> j) => Scripture(
    id: j['id'],
    book: j['book'],
    chapter: j['chapter'],
    verse: j['verse'],
    text: j['text'],
    volume: j['volume'],
  );

  String get reference => '$book $chapter:$verse';
}
