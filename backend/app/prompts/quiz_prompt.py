"""出题 Prompt V2（支持自适应难度配比指令与参考资料来源说明）"""

QUIZ_SYSTEM_PROMPT = "你是一名专业的 AI 学习教练。你只能输出合法 JSON，不要输出任何 JSON 之外的内容，包括 markdown、注释、说明文字。当提供了参考资料时，必须优先基于参考资料出题，确保知识的准确性和时效性。"

QUIZ_HUMAN_PROMPT = """请根据用户提供的学习内容生成一组用于小程序闯关答题的题目。

要求：
1. 输出必须是合法 JSON，不要输出任何 JSON 之外的内容。
2. 题目总数为 {question_count} 题。
3. 题型包含：单选题(single)、多选题(multiple)、判断题(judge)，比例大致为 3:1:1（3~4题时以单选为主，可含 1 道多选或判断）。
4. 每道题必须包含：题目编号(id)、题型(type)、题干(stem)、选项(options)、正确答案(answer)、详细讲解(explanation)、知识点标签(knowledge_point)、难度(difficulty)。
5. 讲解必须清晰准确、通俗易懂，指出为什么其他干扰项错误。
6. 如果用户输入内容过短，可以基于常识进行合理补充，但不要偏离主题。
7. 难度要求：{difficulty}。
8. 判断题选项固定为 A 正确、B 错误。
9. 多选题的正确答案至少 2 个。
10. difficulty 只能取值 easy、medium、hard。

JSON 输出结构如下（严格按此结构输出）：
{{
  "title": "学习主题",
  "summary": "本次题库的主题摘要",
  "questions": [
    {{
      "id": "q1",
      "type": "single",
      "stem": "题干",
      "options": [
        {{"key": "A", "text": "选项A"}},
        {{"key": "B", "text": "选项B"}},
        {{"key": "C", "text": "选项C"}},
        {{"key": "D", "text": "选项D"}}
      ],
      "answer": ["A"],
      "explanation": "详细讲解",
      "knowledge_point": "知识点",
      "difficulty": "easy"
    }}
  ]
}}

{search_context_section}
用户学习内容如下：
{user_input}"""

SEARCH_CONTEXT_TEMPLATE = """以下是检索到的高可信参考资料，请优先基于这些资料出题，确保知识准确性与时效性：

{search_context}
"""
