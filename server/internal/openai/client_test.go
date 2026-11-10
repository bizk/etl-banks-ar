package openai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestToChatParamsSerialization(t *testing.T) {
	tests := []struct {
		name     string
		msg      ChatMessage
		contains []string
	}{
		{"system", ChatMessage{Role: "system", Content: "S"}, []string{`"role":"system"`, `"content":"S"`}},
		{"user default", ChatMessage{Role: "", Content: "U"}, []string{`"role":"user"`, `"content":"U"`}},
		{"plain assistant", ChatMessage{Role: "assistant", Content: "A"}, []string{`"role":"assistant"`, `"content":"A"`}},
		{
			"assistant tool calls",
			ChatMessage{Role: "assistant", ToolCalls: []ToolCall{{ID: "call_1", Name: "search_transactions", Arguments: `{"type":"debit"}`}}},
			[]string{`"role":"assistant"`, `"tool_calls"`, `"id":"call_1"`, `"name":"search_transactions"`, `"type":"function"`},
		},
		{"tool result", ChatMessage{Role: "tool", ToolCallID: "call_1", Content: `{"ok":true}`}, []string{`"role":"tool"`, `"tool_call_id":"call_1"`}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			params := toChatParams([]ChatMessage{tt.msg})
			b, err := json.Marshal(params[0])
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range tt.contains {
				if !strings.Contains(string(b), want) {
					t.Errorf("%s missing %s", b, want)
				}
			}
		})
	}
}
