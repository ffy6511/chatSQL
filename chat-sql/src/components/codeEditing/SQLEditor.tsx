'use client'

import React, { useCallback, useState, useEffect, useRef, useMemo } from "react";
import Editor from '@monaco-editor/react';
import './SQLEditor.css';
import './MonacoEditorStyles.css'; // 添加Monaco编辑器样式
import { SQLQueryEngine } from '@/services/sqlExecutor';
import { Button, ButtonGroup, Tooltip } from '@mui/material';
import { PlayArrow, KeyboardCommandKey, KeyboardReturn } from '@mui/icons-material';
import { message as antdMessage } from 'antd';
import { useLLMContext } from '@/contexts/LLMContext';
import { useQueryContext } from '@/contexts/QueryContext';
import { useEditorContext } from '@/contexts/EditorContext';

interface SQLEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  onExecute?: (data: any) => void;
  height?: string | number;
}

const SQLEditor: React.FC<SQLEditorProps> = ({
  value,
  onChange,
  onExecute,
  height = "100%"
}) => {
  const [messageApi, contextHolder] = antdMessage.useMessage();
  const { llmResult } = useLLMContext();
  const [queryEngine, setQueryEngine] = useState<SQLQueryEngine | null>(null);
  const { sqlEditorValue, setSqlEditorValue } = useEditorContext(); // 使用EditorContext
  const { setQueryResult } = useQueryContext();

  // 当表结构变化时，重新加载编辑器以更新自动补全
  const [editorKey, setEditorKey] = useState<number>(0);

  // 当表结构变化时，更新编辑器key以强制重新加载
  useEffect(() => {
    if (llmResult?.data?.outputs?.tableStructure) {
      setEditorKey(prev => prev + 1);
    }
  }, [llmResult?.data?.outputs?.tableStructure]);

  // 当外部value改变时更新编辑器内容
  useEffect(() => {
    if (value !== undefined && value !== sqlEditorValue) {
      setSqlEditorValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (llmResult?.data?.outputs) {
      const { tableStructure, tuples } = llmResult.data.outputs;
      if (tableStructure && tuples) {
        console.log('Initializing SQLQueryEngine with:', {
          tableStructure,
          tuples
        });
        setQueryEngine(new SQLQueryEngine(tableStructure, tuples));
      }
    }
  }, [llmResult]);

  const handleExecute = useCallback(async () => {
    if (!queryEngine) {
      messageApi.error('请先生成数据库结构');
      setQueryResult([]); // 清空查询结果
      return;
    }

    try {
      console.log('[SQLEditor] Executing query:', sqlEditorValue);
      
      // 检查空语句
      if (!sqlEditorValue.trim()) {
        messageApi.warning('SQL语句不能为空');
        setQueryResult([]); // 清空查询结果
        return;
      }

      const result = queryEngine.executeQuery(sqlEditorValue);
      console.log('[SQLEditor] Query result:', result);

      if (result.success) {
        if (result.data) {
          setQueryResult(result.data);
          onExecute?.(result.data);
        } else {
          setQueryResult([]); // 如果没有数据，清空结果
        }
        if (result.message) {
          messageApi.success(result.message);
        }
      } else {
        setQueryResult([]); // 执行失败时清空结果
        messageApi.error(result.message || 'SQL语句不合法，请检查语法');
      }
    } catch (err) {
      console.error('[SQLEditor] Error:', err);
      setQueryResult([]); // 发生错误时清空结果
      messageApi.error('SQL语句不合法，请检查语法');
    }
  }, [queryEngine, sqlEditorValue, setQueryResult, onExecute, messageApi]);

  // 保存自动补全提供器的引用，以便在需要时取消注册
  const completionProviderRef = useRef<any>(null);

  const handleEditorWillMount = useCallback((monaco: any) => {
    // 导入自动补全提供器和悬停提示提供器
    const { createSQLCompletionProvider } = require('@/lib/sqlCompletionProvider');
    const { createSQLHoverProvider } = require('@/lib/sqlHoverProvider');

    // 尝试清除所有已注册的SQL自动补全提供器
    try {
      // 如果有之前注册的提供器，先取消注册
      if (completionProviderRef.current) {
        completionProviderRef.current.forEach((provider: any) => provider.dispose());
        completionProviderRef.current = [];
      }

      // 清除Monaco编辑器内部可能存在的自动补全提供器
      if (monaco.languages._builtinProviders && monaco.languages._builtinProviders['sql']) {
        const providers = monaco.languages._builtinProviders['sql'].filter(
          (p: any) => p.provider._type !== 'CompletionItemProvider'
        );
        monaco.languages._builtinProviders['sql'] = providers;
      }
    } catch (error) {
      console.warn('清除自动补全提供器失败', error);
    }

    // 初始化提供器引用数组
    if (!completionProviderRef.current) {
      completionProviderRef.current = [];
    }

    // 注册我们自定义的自动补全提供器
    const completionProvider = monaco.languages.registerCompletionItemProvider("sql",
      createSQLCompletionProvider(monaco, llmResult?.data?.outputs?.tableStructure)
    );
    completionProviderRef.current.push(completionProvider);

    // 注册悬停提示提供器
    const hoverProvider = monaco.languages.registerHoverProvider("sql",
      createSQLHoverProvider(monaco, llmResult?.data?.outputs?.tableStructure)
    );
    completionProviderRef.current.push(hoverProvider);

    // 配置编辑器参数，确保显示文档
    monaco.languages.setLanguageConfiguration('sql', {
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
      comments: {
        lineComment: '--',
        blockComment: ['/*', '*/']
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ]
    });
  }, [llmResult?.data?.outputs?.tableStructure]);

  const handleChange = useCallback((newValue: string | undefined) => {
    if (newValue !== undefined && newValue !== sqlEditorValue) {
      setSqlEditorValue(newValue);
      // 只在真正需要时触发 onChange
      onChange?.(newValue);
    }
  }, [onChange, setSqlEditorValue, sqlEditorValue]);

  // 使用 useMemo 缓存编辑器配置
  const editorOptions = useMemo(() => ({
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on',
    roundedSelection: false,
    automaticLayout: true,
  }), []);

  // 保存编辑器实例的引用
  const editorRef = useRef<any>(null);

  // 编辑器挂载后设置键盘快捷键
  const handleEditorDidMount = useCallback((editor: any, monaco: any) => {
    // 保存编辑器实例的引用
    editorRef.current = editor;

    // 添加键盘快捷键：Windows/Command + Enter 执行查询
    editor.addCommand(
      // 使用 CtrlCmd 表示在 Windows 上是 Ctrl，在 Mac 上是 Command
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => {
        if (queryEngine) {
          const currentValue = editor.getValue();
          console.log('执行查询，当前SQL:', currentValue);

          if (!currentValue.trim()) {
            messageApi.warning('SQL语句不能为空');
            setQueryResult([]); // 清空查询结果
            return;
          }

          setSqlEditorValue(currentValue);

          try {
            const result = queryEngine.executeQuery(currentValue);
            if (result.success) {
              if (result.data) {
                setQueryResult(result.data);
                onExecute?.(result.data);
              } else {
                setQueryResult([]); // 如果没有数据，清空结果
              }
              if (result.message) {
                messageApi.success(result.message);
              }
            } else {
              setQueryResult([]); // 执行失败时清空结果
              messageApi.error(result.message || 'SQL语句不合法，请检查语法');
            }
          } catch (err) {
            setQueryResult([]); // 发生错误时清空结果
            messageApi.error('SQL语句不合法，请检查语法');
          }
        } else {
          messageApi.warning('请先生成数据库结构');
          setQueryResult([]); // 清空查询结果
        }
      }
    );

    // 可以在这里添加更多的键盘快捷键
  }, [queryEngine, setSqlEditorValue, setQueryResult, onExecute, messageApi]);

  const handleToolbarClick = () => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue();
      console.log('按钮执行查询，当前SQL:', currentValue);

      if (!currentValue.trim()) {
        messageApi.warning('SQL语句不能为空');
        setQueryResult([]); // 清空查询结果
        return;
      }

      setSqlEditorValue(currentValue);

      try {
        const result = queryEngine!.executeQuery(currentValue);
        if (result.success) {
          if (result.data) {
            setQueryResult(result.data);
            onExecute?.(result.data);
          } else {
            setQueryResult([]); // 如果没有数据，清空结果
          }
          if (result.message) {
            messageApi.success(result.message);
          }
        } else {
          setQueryResult([]); // 执行失败时清空结果
          messageApi.error(result.message || 'SQL语句不合法，请检查语法');
        }
      } catch (err) {
        setQueryResult([]); // 发生错误时清空结果
        messageApi.error('SQL语句不合法，请检查语法');
      }
    } else {
      handleExecute();
    }
  };

  return (
    <div className="sql-editor-container" style={{ position: 'relative' }}>
      {contextHolder}
      <div style={{
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        zIndex: 1000,
      }}>
        <Tooltip
          title={
            <div className="shortcut-tooltip">
              <span>执行查询 </span>
              (<KeyboardCommandKey className="shortcut-icon" />
              <span className="shortcut-plus">+</span>
              <KeyboardReturn className="shortcut-icon" />)
            </div>
          }
          arrow
          placement="left"
        >
          <Button
            variant="contained"
            onClick={handleToolbarClick}
            disabled={!queryEngine}
            sx={{
              minWidth: '40px',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: 'primary.main',
              '&:hover': {
                backgroundColor: 'primary.dark',
              },
              boxShadow: 3,
            }}
          >
            <PlayArrow />
          </Button>
        </Tooltip>
      </div>
      <Editor
        key={editorKey} // 使用key强制重新加载编辑器以更新自动补全
        className="sql-editor"
        height={height}
        defaultLanguage="sql"
        value={sqlEditorValue} // 使用EditorContext而不是本地状态
        theme="vs-dark"
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: "on",
          roundedSelection: false,
          scrollBeyondLastLine: false,
          readOnly: false,
          cursorStyle: "line",
          wordWrap: "on",
          folding: true,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 3,
          // 增强自动补全体验
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: "on",
          tabCompletion: "on",
          wordBasedSuggestions: "currentDocument",
          // 禁用默认的自动补全，启用自定义提示
          suggest: {
            showWords: false,
            showSnippets: false,
            filterGraceful: false,
            snippetsPreventQuickSuggestions: true,
            showStatusBar: true, // 显示状态栏，包含文档信息
            preview: true, // 预览补全项
            previewMode: "prefix", // 预览模式
            selectionMode: "always", // 总是选择第一个补全项
          },
          // 启用悬停提示
          hover: {
            enabled: true,
            delay: 300, // 悬停延迟时间（毫秒）
            sticky: true, // 悬停提示保持显示
            above: false, // 提示显示在光标下方而非上方
          },
          // 参数提示
          parameterHints: {
            enabled: true,
            cycle: true, // 循环显示参数提示
          },
          fontFamily: 'var(--font-mono)',
          fontLigatures: true, // 启用连字
        }}
        beforeMount={handleEditorWillMount}
        onMount={handleEditorDidMount}
        onChange={handleChange}
      />
    </div>
  );
};

export default SQLEditor;
